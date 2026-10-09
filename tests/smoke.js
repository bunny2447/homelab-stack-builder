// Starts apps for real and checks they come up. Needs Docker, pulls images (tens of GB for --all).
//   node tests/smoke.js jellyfin sonarr radarr     test these apps
//   node tests/smoke.js --all                       test every app that has a compose template
//   --batch 10                                      start up to 10 apps at a time (default 8)
// An app passes if all its containers are still running after the wait (not crash-looping) and its
// first web page answers HTTP (any status, even 401/404, means the app is serving).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { loadSite, selectApps } = require("./load");

const argv = process.argv.slice(2);
const batchSize = argv.includes("--batch") ? Number(argv.splice(argv.indexOf("--batch"), 2)[1]) : 8;
const WAIT_SECONDS = 75;
const DESKTOP = process.platform !== "linux"; // Docker Desktop can't reach host-network apps from the host
const site = loadSite();

// Apps that can't fully start without the user's own keys, hardware or content. They still run
// (alone, so they can't break a batch), but a failure is reported as expected.
const NEEDS_INPUT = {
  gluetun: "your VPN provider's key", tailscale: "a Tailscale auth key", cloudflared: "a Cloudflare tunnel token",
  zigbee2mqtt: "a USB Zigbee adapter", authelia: "a configuration.yml", kiwix: "downloaded .zim files",
  ddnsupdater: "a config.json with your DNS provider", beszel: "the agent key from the hub",
};
// Extra seconds to wait for the web page of apps that are slow on first start.
const SLOW = { gitlab: 600, libretranslate: 600, openwebui: 240, anythingllm: 180, photoprism: 180, jupyter: 120, nextcloud: 120 };
// Files the app notes tell users to create before the first start.
const PREPARE = {
  caddy: { "appdata/caddy/etc/Caddyfile": ":80 {\n  respond \"ok\"\n}\n" },
  mosquitto: { "appdata/mosquitto/config/mosquitto.conf": "listener 1883\nallow_anonymous true\n" },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (cwd, ...args) => execFileSync("docker", ["compose", ...args], { cwd, stdio: "pipe", timeout: 45 * 60000 }).toString();

// Windows reserves port ranges for Hyper-V; Docker Desktop can't publish ports inside them.
function windowsReservedPorts() {
  if (process.platform !== "win32") return () => false;
  const out = spawnSync("netsh", ["interface", "ipv4", "show", "excludedportrange", "protocol=tcp"], { encoding: "utf8" }).stdout || "";
  const ranges = [...out.matchAll(/^\s*(\d+)\s+(\d+)/gm)].map((m) => [Number(m[1]), Number(m[2])]);
  return (port) => ranges.some(([a, b]) => port >= a && port <= b);
}
const isReserved = windowsReservedPorts();

function moveOffReservedPorts() {
  const used = new Set(site.allPorts().map((e) => e.host));
  let next = 40000;
  for (const e of site.allPorts()) {
    if (!isReserved(e.host)) continue;
    while (used.has(next) || isReserved(next)) next++;
    site.state.ports[e.key] = next;
    used.add(next);
  }
}

async function httpAnswers(port, https, extraSeconds = 0) {
  const deadline = Date.now() + (30 + extraSeconds) * 1000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${https ? "https" : "http"}://localhost:${port}/`, { signal: AbortSignal.timeout(5000), redirect: "manual" });
      return true;
    } catch (e) {
      // Self-signed HTTPS (e.g. Portainer) fails TLS but proves the port is serving.
      if (https && /certificate|self.signed|SSL|TLS/i.test(String(e.cause || e))) return true;
      await sleep(5000);
    }
  }
  return false;
}

function lastLogLines(app) {
  return (app.services || []).map((s) => {
    const r = spawnSync("docker", ["logs", "--tail", "8", s.name], { encoding: "utf8" });
    return `${r.stdout || ""}${r.stderr || ""}`; // apps log to stdout or stderr
  }).join("\n").trim().split("\n").slice(-8).join("\n      ");
}

async function smokeBatch(ids) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "homelab-smoke-"));
  site.setTarget("desktop");
  Object.assign(site.state.settings, { configRoot: "./appdata", dataRoot: "./data", gpu: false });
  selectApps(site, ids);
  if (site.findConflicts().length) site.autoFixPorts();
  moveOffReservedPorts();
  const compose = site.buildCompose();
  fs.writeFileSync(path.join(dir, "docker-compose.yml"), compose);
  fs.writeFileSync(path.join(dir, ".env"), site.buildEnv(compose));
  for (const id of site.state.selected) {
    for (const [file, content] of Object.entries(PREPARE[id] || {})) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), content);
    }
  }

  const results = {};
  try {
    console.log(`\n▶ ${site.state.selected.join(", ")}`);
    docker(dir, "up", "-d", "--quiet-pull");
    await sleep(WAIT_SECONDS * 1000);
    const ps = docker(dir, "ps", "-a", "--format", "json").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    for (const id of site.state.selected) {
      const app = site.APP_BY_ID[id];
      const problems = [];
      let note = "";
      for (const svc of app.services || []) {
        const c = ps.find((p) => p.Service === svc.name);
        if (!c) problems.push(`${svc.name} missing`);
        else if (c.State !== "running" || /Restarting/i.test(c.Status)) problems.push(`${svc.name} ${c.State} (${c.Status})`);
      }
      // Check each service's first web page. For apps with a setup wizard (AdGuard) that's the wizard,
      // since the main UI only exists after setup.
      for (const svc of app.services || []) {
        const i = (svc.ports || []).findIndex((x) => /UI|wizard/i.test(x.label));
        if (i < 0 || problems.length) continue;
        if (svc.hostNetwork && DESKTOP) { note = " (host network: running check only on Docker Desktop)"; continue; }
        const port = site.hostPort(id, svc, i);
        if (!(await httpAnswers(port, svc.ports[i].https, SLOW[id] || 0))) problems.push(`no HTTP answer on ${port}`);
      }
      if (problems.length) problems.push(`\n      ${lastLogLines(app)}`);
      results[id] = problems;
      const label = problems.length ? (NEEDS_INPUT[id] ? "need" : "FAIL") : "ok  ";
      const why = problems.length ? (NEEDS_INPUT[id] ? `: expected, needs ${NEEDS_INPUT[id]}` : `: ${problems.join("; ")}`) : note;
      console.log(`${label} ${app.name}${why}`);
    }
  } catch (e) {
    const err = String(e.stderr || e.message).trim().split("\n").slice(-4).join(" | ");
    const expected = ids.every((id) => NEEDS_INPUT[id]);
    console.log(`${expected ? "need" : "FAIL"} batch could not start${expected ? `: expected, needs ${ids.map((id) => NEEDS_INPUT[id]).join(", ")}` : ""}: ${err}`);
    site.state.selected.forEach((id) => { results[id] = ["batch failed to start"]; });
  } finally {
    try { docker(dir, "down", "-v", "--remove-orphans"); } catch { /* best effort */ }
    // Containers write files as other users; delete them from inside a container.
    spawnSync("docker", ["run", "--rm", "-v", `${dir}:/w`, "alpine", "sh", "-c", "rm -rf /w/appdata /w/data"]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return results;
}

// Groups apps into batches whose fixed ports (DNS 53, HTTP 80/443…) don't clash.
function planBatches(ids) {
  const batches = [];
  const fixedPorts = (id) => (site.APP_BY_ID[id].services || []).flatMap((s) =>
    (s.ports || []).filter((p) => p.fixed || s.hostNetwork).map((p) => `${p.host}/${p.proto || "tcp"}`));
  for (const id of ids) {
    const mine = fixedPorts(id);
    const fit = batches.find((b) => b.length < batchSize && !b.some((other) => fixedPorts(other).some((p) => mine.includes(p))));
    if (fit) fit.push(id); else batches.push([id]);
  }
  return batches;
}

async function main() {
  const all = argv.includes("--all");
  const requested = all ? site.APPS.map((a) => a.id) : argv.filter((a) => !a.startsWith("--"));
  const unknown = requested.filter((id) => !site.APP_BY_ID[id]);
  if (unknown.length) console.log(`Unknown app ids skipped: ${unknown.join(", ")}`);
  const external = requested.filter((id) => site.APP_BY_ID[id]?.composeUrl);
  if (external.length) console.log(`Not tested (set up from their official compose files): ${external.join(", ")}`);
  const ids = requested.filter((id) => site.APP_BY_ID[id]?.services);

  const normal = ids.filter((id) => !NEEDS_INPUT[id]);
  const batches = [...planBatches(normal), ...ids.filter((id) => NEEDS_INPUT[id]).map((id) => [id])];
  const results = {};
  for (const batch of batches) Object.assign(results, await smokeBatch(batch));

  const failed = Object.keys(results).filter((id) => results[id].length && !NEEDS_INPUT[id]);
  const needInput = Object.keys(results).filter((id) => results[id].length && NEEDS_INPUT[id]);
  const passed = Object.keys(results).length - failed.length - needInput.length;
  console.log(`\n${passed} passed, ${failed.length} failed, ${needInput.length} need the user's own settings (expected)`);
  if (failed.length) console.log(`Failed: ${failed.join(", ")}`);
  process.exitCode = failed.length ? 1 : 0;
}

main();
