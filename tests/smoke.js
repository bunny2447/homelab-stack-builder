// Starts apps for real and checks they come up. Needs Docker, pulls images (can be several GB).
//   node tests/smoke.js jellyfin sonarr radarr     test these apps
//   node tests/smoke.js --batch 10 <ids...>         start 10 at a time (default 8)
// Each app passes if all its containers are still running after the wait (not crash-looping)
// and every web UI port answers HTTP (any status, even 401/404, means the app is serving).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { loadSite, selectApps } = require("./load");

const argv = process.argv.slice(2);
const batchSize = argv.includes("--batch") ? Number(argv.splice(argv.indexOf("--batch"), 2)[1]) : 8;
const WAIT_SECONDS = 75;
const site = loadSite();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (cwd, ...args) => execFileSync("docker", ["compose", ...args], { cwd, stdio: "pipe", timeout: 30 * 60000 }).toString();

async function httpAnswers(port, https) {
  for (let i = 0; i < 6; i++) {
    try {
      const ctrl = AbortSignal.timeout(5000);
      await fetch(`${https ? "https" : "http"}://localhost:${port}/`, { signal: ctrl, redirect: "manual" });
      return true;
    } catch (e) {
      // Self-signed HTTPS (e.g. Portainer) fails TLS but proves the port is serving.
      if (https && /certificate|self.signed|SSL|TLS/i.test(String(e.cause || e))) return true;
      await sleep(5000);
    }
  }
  return false;
}

async function smokeBatch(ids) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "homelab-smoke-"));
  site.setTarget("desktop");
  Object.assign(site.state.settings, { configRoot: "./appdata", dataRoot: "./data", gpu: false });
  selectApps(site, ids);
  const compose = site.buildCompose();
  fs.writeFileSync(path.join(dir, "docker-compose.yml"), compose);
  fs.writeFileSync(path.join(dir, ".env"), site.buildEnv(compose));

  const results = {};
  try {
    console.log(`\n▶ ${ids.join(", ")}`);
    docker(dir, "up", "-d", "--quiet-pull");
    await sleep(WAIT_SECONDS * 1000);
    const ps = docker(dir, "ps", "-a", "--format", "json").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    for (const id of site.state.selected) {
      const app = site.APP_BY_ID[id];
      const problems = [];
      for (const svc of app.services || []) {
        const c = ps.find((p) => p.Service === svc.name);
        if (!c) problems.push(`${svc.name} missing`);
        else if (c.State !== "running" || /Restarting/i.test(c.Status)) problems.push(`${svc.name} ${c.State} (${c.Status})`);
      }
      for (const svc of app.services || []) {
        for (const p of (svc.ports || []).filter((x) => /UI/i.test(x.label))) {
          if (!problems.length && !(await httpAnswers(p.host, p.https))) problems.push(`no HTTP answer on ${p.host}`);
        }
      }
      if (problems.length) {
        // Apps log to stdout or stderr, so collect both.
        const logs = (app.services || []).map((s) => {
          const r = spawnSync("docker", ["logs", "--tail", "8", s.name], { encoding: "utf8" });
          return `${r.stdout || ""}${r.stderr || ""}`;
        }).join("\n").trim().split("\n").slice(-8).join("\n      ");
        problems.push(`\n      ${logs}`);
      }
      results[id] = problems;
      console.log(`${problems.length ? "FAIL" : "ok  "} ${app.name}${problems.length ? `: ${problems.join("; ")}` : ""}`);
    }
  } catch (e) {
    console.log(`FAIL batch could not start: ${String(e.stderr || e.message).trim().split("\n").slice(-5).join(" | ")}`);
    ids.forEach((id) => { results[id] = ["batch failed to start"]; });
  } finally {
    try { docker(dir, "down", "-v", "--remove-orphans"); } catch { /* best effort */ }
    try { execFileSync("docker", ["run", "--rm", "-v", `${dir}:/w`, "alpine", "rm", "-rf", "/w/appdata", "/w/data"], { stdio: "pipe" }); } catch { /* best effort */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return results;
}

async function main() {
  const ids = argv.filter((id) => site.APP_BY_ID[id]);
  const unknown = argv.filter((id) => !site.APP_BY_ID[id]);
  if (unknown.length) console.log(`Unknown app ids skipped: ${unknown.join(", ")}`);
  const all = {};
  for (let i = 0; i < ids.length; i += batchSize) Object.assign(all, await smokeBatch(ids.slice(i, i + batchSize)));
  const failed = Object.entries(all).filter(([, p]) => p.length).map(([id]) => id);
  console.log(`\n${Object.keys(all).length - failed.length}/${Object.keys(all).length} apps came up${failed.length ? `. Failed: ${failed.join(", ")}` : ""}`);
  process.exitCode = failed.length ? 1 : 0;
}

main();
