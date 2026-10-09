// Catalog and generator checks. Run with: node tests/run.js [--compose] [--images] [--offline]
//   --compose  validate generated files with `docker compose config` (needs Docker CLI)
//   --images   check every image exists on its registry (needs Docker CLI + network, slow)
//   --offline  skip the Proxmox helper-script name check (needs network)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, execFile } = require("child_process");
const { loadSite, selectApps } = require("./load");

const args = new Set(process.argv.slice(2));
const site = loadSite();
const { state, APPS, GOALS, TOP_PICKS, APP_BY_ID, TARGETS } = site;
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "homelab-tests-"));
let failures = 0;

function check(ok, message, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}${!ok && detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
}

function composeValid(dir) {
  try {
    execFileSync("docker", ["compose", "config", "-q"], { cwd: dir, stdio: "pipe" });
    return "";
  } catch (e) {
    return String(e.stderr || e.message).trim();
  }
}

function writeStack(name) {
  const dir = path.join(outDir, name);
  fs.mkdirSync(dir, { recursive: true });
  const compose = site.buildCompose();
  fs.writeFileSync(path.join(dir, "docker-compose.yml"), compose);
  fs.writeFileSync(path.join(dir, ".env"), site.buildEnv(compose));
  return dir;
}

async function main() {
  // ---- Catalog integrity
  const ids = APPS.map((a) => a.id);
  const dupes = (list) => [...new Set(list.filter((x, i) => list.indexOf(x) !== i))];
  check(!dupes(ids).length, `unique app ids (${ids.length} apps)`, dupes(ids));
  const svcNames = APPS.flatMap((a) => (a.services || []).map((s) => s.name));
  check(!dupes(svcNames).length, "unique service/container names", dupes(svcNames));
  const incomplete = APPS.filter((a) => !a.name || !a.category || !a.desc || !a.docs || !a.difficulty || (!a.services && !a.composeUrl));
  check(!incomplete.length, "every app has name, category, desc, docs, difficulty and services or composeUrl", incomplete.map((a) => a.id));
  const missing = [...GOALS.flatMap((g) => g.picks), ...TOP_PICKS].filter((id) => !APP_BY_ID[id]);
  check(!missing.length, "goal picks and Top 10 refer to real apps", missing);
  check(!dupes(GOALS.map((g) => g.id)).length, "unique goal ids", dupes(GOALS.map((g) => g.id)));
  check(GOALS.every((g) => g.group && site.recommendedFor(g).length), "every goal has a group and a recommendation");
  check(TOP_PICKS.length === 10, "Top 10 has 10 apps");

  // ---- Full stack: every app except ones that deliberately fight over fixed ports
  const rivals = new Set(["pihole", "technitium", "caddy", "traefik"]);
  selectApps(site, ids.filter((id) => !rivals.has(id)));
  state.settings.gpu = true;
  site.renderBuilder();
  const conflicts = site.findConflicts().map(([p, es]) => `${p}=${es.map((e) => e.app.id).join("+")}`);
  check(!conflicts.length, "no host port conflicts between default ports", conflicts.join(" "));
  const env = site.buildEnv(site.buildCompose());
  check(/=base64:[A-Za-z0-9+/]{43}=\n/.test(env) && /HOMARR_SECRET_KEY=[0-9a-f]{64}\n/.test(env), "secret formats (laravel, hex64)");
  if (args.has("--compose")) {
    check(!composeValid(writeStack("full")), "full stack passes docker compose config", composeValid(path.join(outDir, "full")));
  }

  // ---- Share link, requirements and removal
  selectApps(site, ["openwebui"]);
  check(state.selected.join() === "ollama,openwebui", "adding Open WebUI brings Ollama");
  check(site.removeApp("ollama").join() === "Open WebUI" && !state.selected.length, "removing Ollama removes Open WebUI");

  // ---- Gluetun routing
  selectApps(site, ["qbittorrent", "gluetun"]);
  const vpnCompose = site.buildCompose();
  check(vpnCompose.includes('network_mode: "service:gluetun"') && /gluetun:[\s\S]*qBittorrent Web UI/.test(vpnCompose),
    "qBittorrent routes through Gluetun, ports move to gluetun");

  // ---- Deploy targets
  selectApps(site, ids.filter((id) => !rivals.has(id)));
  for (const target of Object.keys(TARGETS)) {
    site.setTarget(target);
    site.renderBuilder();
    const setup = site.buildSetup();
    check(setup.startsWith("# Setup guide") && !setup.includes("undefined"), `setup guide renders for ${target}`);
    if (args.has("--compose")) check(!composeValid(writeStack(target)), `${target} compose passes docker compose config`);
  }
  site.setTarget("synology");
  check(state.settings.configRoot === "/volume1/docker" && state.settings.puid === "1026", "Synology defaults applied");
  check(site.reservedClashes().some((e) => e.app.id === "kavita"), "Synology: Kavita clashes with DSM on 5000");
  site.autoFixPorts();
  check(site.reservedClashes().every((e) => e.p.fixed), "auto-fix moves apps off ports the NAS uses");
  site.setTarget("docker");
  check(state.settings.configRoot === "/opt/homelab/appdata", "switching back restores default folders");

  // ---- Proxmox: one LXC per app
  site.setTarget("pve-native");
  const modes = { script: 0, oci: 0, docker: 0 };
  APPS.forEach((a) => modes[site.nativeMode(a) || "docker"]++);
  console.log(`     LXC per app: ${modes.script} helper scripts, ${modes.oci} images as LXC, ${modes.docker} need Docker`);
  // Same patterns Proxmox's API validates against (pve-storage oci-registry-pull, pve-container env).
  const refRe = /^(?:(?:[a-zA-Z\d]|[a-zA-Z\d][a-zA-Z\d-]*[a-zA-Z\d])(?:\.(?:[a-zA-Z\d]|[a-zA-Z\d][a-zA-Z\d-]*[a-zA-Z\d]))*(?::\d+)?\/)?[a-z\d]+(?:(?:[._]|__|[-]*)[a-z\d]+)*(?:\/[a-z\d]+(?:(?:[._]|__|[-]*)[a-z\d]+)*)*:\w[\w.-]{0,127}$/;
  const ociApps = APPS.filter((a) => site.nativeMode(a) === "oci");
  const badRefs = ociApps.map((a) => site.fullImageRef(a.services[0].image)).filter((r) => !refRe.test(r));
  check(!badRefs.length, "image references match Proxmox's pattern", badRefs);
  const badEnv = ociApps.flatMap((a) => site.ociCommands(a)).flatMap((c) =>
    [...c.matchAll(/'lxc\.environment\.runtime: ([^']*)'/g)].map((m) => m[1])).filter((v) => !/^\w+=[^\x00-\x08\x0a-\x1F\x7F]*$/.test(v));
  check(!badEnv.length, "LXC env lines match Proxmox's pattern", badEnv);
  const shellLines = site.buildSetup().split("\n").filter((l) => l.startsWith("    ")).map((l) => l.slice(4)).join("\n");
  const shellFile = path.join(outDir, "setup-commands.sh");
  fs.writeFileSync(shellFile, shellLines + "\n");
  let shellError = "";
  try { execFileSync("bash", ["-n", shellFile], { stdio: "pipe" }); } catch (e) { shellError = String(e.stderr || e.message); }
  check(!shellError, "generated Proxmox commands are valid shell", shellError);
  if (args.has("--compose")) check(!composeValid(writeStack("pve-native")), "LXC-per-app leftover compose passes docker compose config");
  site.setTarget("docker");

  // ---- Network checks
  if (!args.has("--offline")) {
    const headers = { "User-Agent": "homelab-stack-builder-tests" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch("https://api.github.com/repos/community-scripts/ProxmoxVE/git/trees/main?recursive=1", { headers });
    const tree = (await res.json()).tree || [];
    const scripts = new Set(tree.map((t) => t.path));
    const badSlugs = APPS.filter((a) => a.lxc && !scripts.has(`ct/${a.lxc}.sh`)).map((a) => `${a.id}:${a.lxc}`);
    check(tree.length > 0 && !badSlugs.length, `Proxmox helper scripts exist (${APPS.filter((a) => a.lxc).length} apps)`, badSlugs);
  }
  if (args.has("--images")) {
    const images = [...new Set(APPS.flatMap((a) => (a.services || []).map((s) => s.image)))];
    const exists = (img, tries = 3) => new Promise((resolve) => {
      execFile("docker", ["manifest", "inspect", img], { timeout: 60000 }, (err) => {
        if (!err || tries <= 1) return resolve(!err);
        setTimeout(() => exists(img, tries - 1).then(resolve), 5000); // registries rate-limit bursts
      });
    });
    const missingImages = [];
    for (let i = 0; i < images.length; i += 4) {
      const batch = images.slice(i, i + 4);
      const results = await Promise.all(batch.map((img) => exists(img)));
      batch.forEach((img, j) => { if (!results[j]) missingImages.push(img); });
    }
    check(!missingImages.length, `all ${images.length} images exist on their registries`, missingImages);
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exitCode = failures ? 1 : 0;
}

main();
