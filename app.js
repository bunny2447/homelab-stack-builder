// Homelab Stack Builder: picker + compose generator. No dependencies.

// Compact catalog entries (see apps-more.js) become a normal single service.
for (const a of APPS) {
  if (a.services || !a.image) continue;
  const port = a.port && { host: a.port[0], container: a.port[1], label: "Web UI", ...a.port[2] };
  a.services = [{
    name: a.id, image: a.image, user: a.user, command: a.command, hostNetwork: a.hostNetwork, pid: a.pid,
    capAdd: a.capAdd, devices: a.devices, sysctls: a.sysctls, env: a.env,
    ports: a.ports || (port ? [port] : []),
    volumes: [...(a.data ? [`\${CONFIG_ROOT}/${a.id}:${a.data}`] : []), ...(a.volumes || [])],
  }];
}

const STORAGE_KEY = "homelab-stack-builder-v1";
const APP_BY_ID = Object.fromEntries(APPS.map((a) => [a.id, a]));
const categoryRank = (c) => (CATEGORY_ORDER.includes(c) ? CATEGORY_ORDER.indexOf(c) : 999);
const CATEGORIES = ["All", ...[...new Set(APPS.map((a) => a.category))].sort((a, b) => categoryRank(a) - categoryRank(b))];
const SETTING_VARS = {
  tz: "TZ", puid: "PUID", pgid: "PGID", configRoot: "CONFIG_ROOT", dataRoot: "DATA_ROOT",
};

function defaultState() {
  return {
    view: "picker",
    goals: [],
    level: 1,
    selected: [],     // app ids, in the order they were added
    ports: {},        // "appId/service/index" -> host port override
    secrets: {},      // ENV_NAME -> generated value
    settings: {
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC",
      puid: "1000", pgid: "1000", restart: "unless-stopped",
      configRoot: "/opt/homelab/appdata", dataRoot: "/mnt/data",
      gpu: false, host: "", deploy: "docker",
    },
  };
}

function load() {
  const base = defaultState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      Object.assign(base, saved, { settings: { ...base.settings, ...saved.settings } });
      base.selected = base.selected.filter((id) => APP_BY_ID[id]);
      if (!TARGETS[base.settings.deploy]) base.settings.deploy = "docker";
    }
  } catch { /* storage unavailable or corrupt: use defaults */ }
  return base;
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

let state = load();
let catalogFilter = { q: "", cat: "All", collapsed: new Set() };
let outTab = "compose";
// Goal groups the user has expanded in the picker. Groups with picked goals start open.
let openGoalGroups = new Set(GOALS.filter((g) => state.goals.includes(g.id)).map((g) => g.group));

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2200);
}

// format: a length, "hex64" (64 hex chars) or "laravel" (base64:<32 random bytes>, for Laravel APP_KEYs).
function randomSecret(format = 24) {
  if (format === "laravel") {
    return "base64:" + btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  }
  if (format === "hex64") {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(format));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

const servicesOf = (app) => app.services || [];
// Apps flagged vpn are routed through Gluetun whenever it's in the stack.
const vpnRouted = (app) => Boolean(app.vpn) && isSelected("gluetun") && !isNative(APP_BY_ID.gluetun);
// Apps that end up as services in docker-compose.yml.
const inCompose = (app) => !app.composeUrl && !isNative(app);
const reservedPorts = () => TARGETS[state.settings.deploy].reserved || {};

// ---------------------------------------------------------------- views

function setView(view) {
  state.view = view;
  save();
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.view === view);
    t.setAttribute("aria-selected", t.dataset.view === view);
  });
  $("#view-picker").hidden = view !== "picker";
  $("#view-builder").hidden = view !== "builder";
  if (view === "builder") renderBuilder();
  window.scrollTo({ top: 0 });
}

function isSelected(id) { return state.selected.includes(id); }

// Adds an app plus anything it requires (requirements first, so they come first in the file).
function addApp(id) {
  const app = APP_BY_ID[id];
  if (!app || isSelected(id)) return;
  (app.requires || []).forEach(addApp);
  state.selected.push(id);
  (app.secrets || []).forEach((s) => { if (!state.secrets[s]) state.secrets[s] = randomSecret(app.secretFormats?.[s]); });
  save();
}

// Removes an app plus any app that requires it. Returns the names of those extra apps.
function removeApp(id) {
  const removed = [];
  const drop = (x) => {
    if (!isSelected(x)) return;
    state.selected = state.selected.filter((y) => y !== x);
    Object.keys(state.ports).forEach((k) => { if (k.startsWith(`${x}/`)) delete state.ports[k]; });
    removed.push(x);
    state.selected.filter((y) => (APP_BY_ID[y].requires || []).includes(x)).forEach(drop);
  };
  drop(id);
  save();
  return removed.slice(1).map((x) => APP_BY_ID[x].name);
}

// Toggles an app and tells the user about anything that came or went with it.
function toggleApp(id) {
  const app = APP_BY_ID[id];
  if (isSelected(id)) {
    const also = removeApp(id);
    if (also.length) toast(`Also removed ${also.join(", ")} (needs ${app.name})`);
    return;
  }
  const before = new Set(state.selected);
  addApp(id);
  const extra = state.selected.filter((x) => x !== id && !before.has(x)).map((x) => APP_BY_ID[x].name);
  toast(`Added ${app.name}${extra.length ? ` and ${extra.join(", ")}` : ""}`);
}

function updateCount() { $("#stackCount").textContent = state.selected.length; }

// ---------------------------------------------------------------- share links

function shareUrl() {
  return `${location.href.split("#")[0]}#stack=${state.selected.join(",")}`;
}

// Opening a link like page.html#stack=jellyfin,sonarr loads that stack into the builder.
function applyShareLink() {
  const m = location.hash.match(/[#&]stack=([^&]*)/);
  if (!m) return;
  const ids = decodeURIComponent(m[1]).split(",").filter((id) => APP_BY_ID[id]);
  state.selected = [];
  state.ports = {};
  ids.forEach(addApp);
  state.view = "builder";
  save();
  history.replaceState(null, "", location.href.split("#")[0]);
  if (ids.length) setTimeout(() => toast(`Loaded a shared stack with ${ids.length} app${ids.length > 1 ? "s" : ""}`), 300);
}

// ---------------------------------------------------------------- picker

function renderPicker() {
  // Each group is a collapsible dropdown; it shows how many goals are picked even when closed.
  const groups = [...new Set(GOALS.map((g) => g.group))];
  $("#goalGroups").innerHTML = groups.map((group) => {
    const goals = GOALS.filter((g) => g.group === group);
    const picked = goals.filter((g) => state.goals.includes(g.id)).length;
    return `
    <details class="goal-group" data-goal-group="${esc(group)}" ${openGoalGroups.has(group) ? "open" : ""}>
      <summary>
        <span class="group-name">${esc(group)}</span>
        <span class="muted small">${goals.length} ideas</span>
        ${picked ? `<span class="badge rec">${picked} picked</span>` : ""}
      </summary>
      <div class="goal-grid">${goals.map((g) => {
        const on = state.goals.includes(g.id);
        return `
          <button class="goal ${on ? "on" : ""}" data-goal="${g.id}" aria-pressed="${on}">
            <span class="ico" aria-hidden="true">${g.icon}</span><span>${esc(g.label)}</span>
          </button>`;
      }).join("")}</div>
    </details>`;
  }).join("");
  $("#toggleGoalsBtn").textContent = openGoalGroups.size === groups.length ? "Collapse all" : "Expand all";

  document.querySelectorAll("#levelPicker button").forEach((b) => {
    const on = Number(b.dataset.level) === state.level;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on);
  });

  $("#deployPicker").innerHTML = Object.entries(TARGETS).map(([id, t]) => {
    const on = state.settings.deploy === id;
    return `
      <button class="deploy ${on ? "on" : ""}" data-deploy="${id}" aria-pressed="${on}">
        <span class="ico" aria-hidden="true">${t.icon}</span>
        <span><strong>${esc(t.label)}</strong><small>${esc(t.short)}</small></span>
      </button>`;
  }).join("");

  renderResults();
}

// The recommended pick for a goal: the first app at or below the user's level,
// falling back to the easiest one. Bundled goals recommend every app.
function recommendedFor(goal) {
  if (goal.bundle) return goal.picks;
  const apps = goal.picks.map((id) => APP_BY_ID[id]);
  const fit = apps.find((a) => a.difficulty <= state.level)
    || apps.slice().sort((a, b) => a.difficulty - b.difficulty)[0];
  return [fit.id];
}

function renderResults() {
  const goals = GOALS.filter((g) => state.goals.includes(g.id));
  $("#results").hidden = goals.length === 0;
  if (!goals.length) return;

  $("#resultList").innerHTML = goals.map((g) => {
    const rec = recommendedFor(g);
    return `
      <div class="goal-result">
        <h3>${g.icon} ${esc(g.label)}</h3>
        ${g.picks.map((id) => suggestionHtml(APP_BY_ID[id], rec.includes(id))).join("")}
      </div>`;
  }).join("");
}

function suggestionHtml(app, recommended) {
  const tooHard = app.difficulty > state.level;
  const action = isSelected(app.id)
    ? `<button class="btn small added" data-toggle="${app.id}">✓ In stack</button>`
    : `<button class="btn small ${recommended ? "primary" : ""}" data-toggle="${app.id}">+ Add to stack</button>`;
  const needs = (app.requires || []).map((id) => APP_BY_ID[id].name);
  const docsLink = app.composeUrl && !isNative(app)
    ? `<a class="btn small ghost" href="${app.composeUrl}" target="_blank" rel="noopener">Official compose ↗</a>`
    : `<a class="btn small ghost" href="${app.docs}" target="_blank" rel="noopener">Docs</a>`;
  return `
    <div class="suggestion ${recommended ? "rec" : ""}">
      <div class="info">
        <div class="title">
          ${esc(app.name)}
          ${recommended ? `<span class="badge rec">Recommended</span>` : ""}
          <span class="badge d${app.difficulty}">${DIFFICULTY[app.difficulty]}</span>
          ${appBadges(app)}
        </div>
        <p>${esc(app.desc)}</p>
        ${needs.length ? `<p>Comes with ${esc(needs.join(", "))}.</p>` : ""}
        ${tooHard ? `<p>⚠️ A step up from your level. Worth it, but read the docs first.</p>` : ""}
        ${app.composeUrl && !isNative(app) ? `<p>${esc(app.note)}</p>` : ""}
      </div>
      <div>${action} ${docsLink}</div>
    </div>`;
}

// Badges that depend on the deploy target: separate setup, or its own LXC on Proxmox.
function appBadges(app) {
  if (nativeMode(app) === "script") return `<span class="badge ext">LXC script</span>`;
  if (nativeMode(app) === "oci") return `<span class="badge ext">Image as LXC</span>`;
  if (app.composeUrl) return `<span class="badge ext">Separate setup</span>`;
  return "";
}

// ---------------------------------------------------------------- builder: catalog

function appTile(a, rank) {
  const on = isSelected(a.id);
  return `
    <button class="app ${on ? "on" : ""}" data-toggle="${a.id}" aria-pressed="${on}">
      <div class="row"><span class="name">${rank ? `<span class="rank">${rank}</span>` : ""}${esc(a.name)}</span><span class="check" aria-hidden="true">${on ? "✓" : ""}</span></div>
      <p>${esc(a.desc)}</p>
      <div><span class="badge d${a.difficulty}">${DIFFICULTY[a.difficulty]}</span> ${appBadges(a)}</div>
    </button>`;
}

function catalogSection(key, title, apps, intro = "", ranked = false) {
  const open = !catalogFilter.collapsed.has(key);
  return `
    <details class="cat-group" data-group="${esc(key)}" ${open ? "open" : ""}>
      <summary><h3>${title} <span class="muted">${apps.length}</span></h3></summary>
      ${intro ? `<p class="muted small">${intro}</p>` : ""}
      <div class="app-grid">${apps.map((a, i) => appTile(a, ranked ? i + 1 : 0)).join("")}</div>
    </details>`;
}

function renderCatalog() {
  $("#catFilter").innerHTML = CATEGORIES.map((c) =>
    `<button class="chip ${c === catalogFilter.cat ? "on" : ""}" data-cat="${c}" aria-pressed="${c === catalogFilter.cat}">${c}</button>`).join("");
  $("#catalogCount").textContent = APPS.length;

  const q = catalogFilter.q.toLowerCase();
  const apps = APPS.filter((a) =>
    (catalogFilter.cat === "All" || a.category === catalogFilter.cat) &&
    (!q || (a.name + " " + a.desc + " " + a.category).toLowerCase().includes(q)));
  if (!apps.length) {
    $("#catalog").innerHTML = `<div class="empty">No apps match “${esc(catalogFilter.q)}”.</div>`;
    return;
  }

  // A search shows one flat list of matches; browsing shows Top 10 then every category.
  if (q) {
    $("#catalog").innerHTML = catalogSection("search", `Results for “${esc(catalogFilter.q)}”`, apps);
    return;
  }
  const sections = [];
  if (catalogFilter.cat === "All") {
    sections.push(catalogSection("top", "⭐ Top 10 recommended", TOP_PICKS.map((id) => APP_BY_ID[id]),
      "Popular, well-supported apps most homelabs start with.", true));
  }
  for (const cat of CATEGORIES.slice(1)) {
    const list = apps.filter((a) => a.category === cat).sort((a, b) => a.difficulty - b.difficulty || a.name.localeCompare(b.name));
    if (list.length) sections.push(catalogSection(cat, esc(cat), list));
  }
  $("#catalog").innerHTML = sections.join("");
}

// ---------------------------------------------------------------- builder: ports

function portKey(appId, svcName, i) { return `${appId}/${svcName}/${i}`; }

function hostPort(appId, svc, i) {
  return Number(state.ports[portKey(appId, svc.name, i)] ?? svc.ports[i].host);
}

// Every host port the compose stack uses, with its effective (possibly overridden) number.
function allPorts() {
  const list = [];
  for (const id of state.selected) {
    const app = APP_BY_ID[id];
    if (!inCompose(app)) continue;
    for (const svc of servicesOf(app)) {
      (svc.ports || []).forEach((p, i) => {
        list.push({ key: portKey(id, svc.name, i), app, svc, p, proto: p.proto || "tcp", host: hostPort(id, svc, i) });
      });
    }
  }
  return list;
}

function findConflicts() {
  const byPort = {};
  for (const e of allPorts()) (byPort[`${e.host}/${e.proto}`] ||= []).push(e);
  return Object.entries(byPort).filter(([, es]) => es.length > 1);
}

// Ports the stack wants that the host OS itself already uses (e.g. Synology DSM on 5000).
function reservedClashes() {
  const reserved = reservedPorts();
  return allPorts().filter((e) => e.proto === "tcp" && reserved[e.host]);
}

function autoFixPorts() {
  const used = new Set(Object.keys(reservedPorts()).map((p) => `${p}/tcp`));
  const all = allPorts();
  // Fixed ports (DNS, 80/443) claim their numbers first.
  all.filter((e) => e.p.fixed || e.svc.hostNetwork).forEach((e) => used.add(`${e.host}/${e.proto}`));
  let moved = 0;
  for (const e of all) {
    if (e.p.fixed || e.svc.hostNetwork) continue;
    let port = e.host;
    if (used.has(`${port}/${e.proto}`)) {
      while (used.has(`${port}/${e.proto}`) || port === e.host) port++;
      state.ports[e.key] = port;
      moved++;
    }
    used.add(`${port}/${e.proto}`);
  }
  save();
  renderBuilder();
  toast(moved ? `Moved ${moved} port${moved > 1 ? "s" : ""}` : "Nothing to fix");
}

// ---------------------------------------------------------------- builder: stack list + warnings

function renderSelected() {
  const conflictKeys = new Set([
    ...findConflicts().flatMap(([, es]) => es.map((e) => e.key)),
    ...reservedClashes().map((e) => e.key),
  ]);
  if (!state.selected.length) {
    $("#selectedList").innerHTML = `<div class="empty">No apps yet. Pick some from the catalog, or use <a href="#" data-goto="picker">Find apps</a>.</div>`;
    return;
  }
  $("#selectedList").innerHTML = state.selected.map((id) => {
    const app = APP_BY_ID[id];
    const ports = !inCompose(app) ? "" : servicesOf(app).flatMap((svc) => (svc.ports || []).map((p, i) => {
      const key = portKey(id, svc.name, i);
      const target = p.linkEnv ? "same port" : `${p.container}${p.proto === "udp" ? "/udp" : ""}`;
      return `
        <label class="port ${conflictKeys.has(key) ? "conflict" : ""}" title="${p.fixed ? "This port usually must stay as-is" : ""}">
          ${esc(p.label)}
          <input type="number" min="1" max="65535" value="${hostPort(id, svc, i)}" data-port="${key}" ${svc.hostNetwork ? "disabled" : ""}>
          → ${target}${p.fixed ? " 📌" : ""}
        </label>`;
    })).join("");
    let where = "";
    if (nativeMode(app) === "script") {
      where = `<p class="sel-note">🧩 Gets its own LXC from a Proxmox helper script. See the Setup guide tab.</p>`;
    } else if (nativeMode(app) === "oci") {
      where = `<p class="sel-note">🧩 Proxmox runs its image directly as an LXC (PVE 9.1+). See the Setup guide tab.</p>`;
    } else if (state.settings.deploy === "pve-native") {
      where = `<p class="sel-note">🐳 Can't run as a plain LXC (${esc(ociBlocker(app))}), so it goes in a Docker LXC.${app.lxcAlt ? ` ${esc(app.lxcAlt)}` : ""}</p>`;
    } else if (app.composeUrl) {
      where = `<p class="sel-note">📦 Not in the generated file. Set it up from the <a href="${app.composeUrl}" target="_blank" rel="noopener">official compose file ↗</a>. ${esc(app.note)}</p>`;
    }
    return `
      <div class="sel-app">
        <div class="sel-head">
          <span class="name">${esc(app.name)} <span class="badge d${app.difficulty}">${DIFFICULTY[app.difficulty]}</span></span>
          <span><a class="small" href="${app.docs}" target="_blank" rel="noopener">docs</a>
          <button class="icon-btn" data-remove="${id}" title="Remove ${esc(app.name)}" aria-label="Remove ${esc(app.name)}">✕</button></span>
        </div>
        ${where}
        ${app.note && inCompose(app) ? `<p class="sel-note">💡 ${esc(app.note)}</p>` : ""}
        ${ports ? `<div class="ports">${ports}</div>` : ""}
      </div>`;
  }).join("");
}

function renderWarnings() {
  const conflicts = findConflicts();
  const reserved = reservedClashes();
  const target = TARGETS[state.settings.deploy];
  const composeApps = state.selected.map((id) => APP_BY_ID[id]).filter(inCompose);
  const out = [];
  if (conflicts.length || reserved.length) {
    const fixedClash = conflicts.some(([, es]) => es.filter((e) => e.p.fixed || e.svc.hostNetwork).length > 1);
    const reservedNames = reservedPorts();
    out.push(`
      <div class="warn bad">
        <strong>Port conflicts:</strong> two things can't use the same host port.
        <ul>${conflicts.map(([port, es]) =>
          `<li><code>${port}</code>: ${es.map((e) => esc(e.app.name)).join(", ")}</li>`).join("")}
          ${reserved.map((e) => `<li><code>${e.host}/tcp</code>: ${esc(e.app.name)} and ${esc(reservedNames[e.host])}</li>`).join("")}</ul>
        ${fixedClash ? `<div>📌 Some clashes are on ports that can't move (like DNS on 53). Pick only one of those apps.</div>` : ""}
        ${reserved.some((e) => e.p.fixed) ? `<div>📌 ${esc(target.label)} already uses ports 80/443. Move its own web UI to other ports first, or skip the reverse proxy.</div>` : ""}
        <button class="btn small" id="autoFixBtn">Auto-fix ports</button>
      </div>`);
  }
  if (isSelected("pihole") && isSelected("adguard")) {
    out.push(`<div class="warn">Pi-hole and AdGuard Home do the same job. You usually only want one.</div>`);
  }
  const hostNet = composeApps.filter((a) => servicesOf(a).some((s) => s.hostNetwork));
  if (hostNet.length && state.settings.deploy === "desktop") {
    out.push(`<div class="warn">${esc(hostNet.map((a) => a.name).join(", "))} need${hostNet.length === 1 ? "s" : ""} <code>network_mode: host</code>, which only works on Linux, not Docker Desktop.</div>`);
  }
  if (state.settings.gpu && state.settings.deploy === "desktop") {
    out.push(`<div class="warn">GPU transcoding isn't available on Docker Desktop, so it's left out of the file.</div>`);
  }
  if (isSelected("gluetun") && !isNative(APP_BY_ID.gluetun)) {
    const routed = composeApps.filter((a) => a.vpn);
    out.push(routed.length
      ? `<div class="warn info">🕶️ ${esc(routed.map((a) => a.name).join(", "))} will send all traffic through Gluetun. Their ports are published on the gluetun container.</div>`
      : `<div class="warn info">Gluetun is in your stack, but nothing is routed through it yet. Add qBittorrent or Transmission.</div>`);
  }
  const native = state.selected.map((id) => APP_BY_ID[id]).filter(isNative);
  if (native.length) {
    out.push(`<div class="warn info">🧩 ${native.length} app${native.length > 1 ? "s get their own LXC" : " gets its own LXC"}. The commands are in the <a href="#" data-out="setup">Setup guide</a> tab.${composeApps.length ? " The rest run with Docker." : ""}</div>`);
  }
  $("#warnings").innerHTML = out.join("");
}

// ---------------------------------------------------------------- builder: generation

// Double-quote a YAML scalar; values like ${VAR} stay intact for Compose to interpolate.
const q = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function portLine(id, svc, p, i, labelPrefix = "") {
  const host = hostPort(id, svc, i);
  const container = p.linkEnv ? host : p.container;
  const proto = p.proto === "udp" ? "/udp" : "";
  return `      - ${q(`${host}:${container}${proto}`)}  # ${labelPrefix}${p.label}`;
}

function buildCompose() {
  const s = state.settings;
  const apps = state.selected.map((id) => APP_BY_ID[id]);
  const templated = apps.filter(inCompose);
  const external = apps.filter((a) => a.composeUrl && !isNative(a));
  const native = apps.filter(isNative);
  const gpu = s.gpu && s.deploy !== "desktop";
  const lines = [
    "# Generated by Homelab Stack Builder",
    `# Target: ${TARGETS[s.deploy].label}`,
    `# Apps: ${templated.map((a) => a.name).join(", ") || "(none)"}`,
    "# Values like ${TZ} come from the .env file in the same folder.",
    "# Images track :latest (or a major version). Pin exact tags if you want fully repeatable installs.",
  ];
  if (native.length) {
    lines.push("#", `# In their own Proxmox LXC instead (see SETUP.md): ${native.map((a) => a.name).join(", ")}`);
  }
  if (external.length) {
    lines.push("#", "# Not included here. Set these up from their official compose files:");
    external.forEach((a) => lines.push(`#   ${a.name}: ${a.composeUrl}`));
  }
  lines.push("", "services:");
  if (!templated.length) lines.push(native.length ? "  # Every app runs in its own LXC. Nothing to run with Docker." : "  # Add some apps to get started!");

  // Ports of VPN-routed apps get published on the gluetun container instead.
  const routedPorts = templated.filter(vpnRouted).flatMap((a) =>
    servicesOf(a).flatMap((svc) => (svc.ports || []).map((p, i) => portLine(a.id, svc, p, i, `${a.name} `))));

  for (const app of templated) {
    const id = app.id;
    const routed = vpnRouted(app);
    lines.push("", `  # ---- ${app.name} ----`);
    for (const svc of servicesOf(app)) {
      lines.push(`  ${svc.name}:`);
      lines.push(`    image: ${svc.image}`);
      lines.push(`    container_name: ${svc.name}`);
      if (svc.user) lines.push(`    user: ${q(svc.user)}`);
      if (svc.command) lines.push(`    command: ${q(svc.command)}`);
      if (svc.hostNetwork) lines.push("    network_mode: host");
      else if (routed) lines.push(`    network_mode: "service:gluetun"`);
      if (svc.pid) lines.push(`    pid: ${svc.pid}`);

      const ports = svc.hostNetwork || routed ? [] : (svc.ports || []).map((p, i) => portLine(id, svc, p, i));
      if (svc.name === "gluetun") ports.push(...routedPorts);
      if (ports.length) lines.push("    ports:", ...ports);

      const env = { ...(app.lsio ? { PUID: "${PUID}", PGID: "${PGID}", TZ: "${TZ}" } : {}), ...(svc.env || {}) };
      (svc.ports || []).forEach((p, i) => { if (p.linkEnv) env[p.linkEnv] = String(hostPort(id, svc, i)); });
      if (Object.keys(env).length) {
        lines.push("    environment:");
        for (const [k, v] of Object.entries(env)) lines.push(`      - ${q(`${k}=${v}`)}`);
      }
      if (svc.capAdd?.length) lines.push("    cap_add:", ...svc.capAdd.map((c) => `      - ${c}`));
      const devices = [...(svc.devices || []), ...(gpu && app.gpu ? ["/dev/dri:/dev/dri"] : [])];
      if (devices.length) lines.push("    devices:", ...devices.map((d) => `      - ${q(d)}`));
      if (svc.sysctls?.length) lines.push("    sysctls:", ...svc.sysctls.map((x) => `      - ${q(x)}`));
      if (svc.volumes?.length) lines.push("    volumes:", ...svc.volumes.map((v) => `      - ${q(v)}`));
      const depends = [...(svc.depends || []), ...(routed ? ["gluetun"] : [])];
      if (depends.length) lines.push("    depends_on:", ...depends.map((d) => `      - ${d}`));
      lines.push(`    restart: ${s.restart === "no" ? '"no"' : s.restart}`);
    }
  }
  return lines.join("\n") + "\n";
}

// .env values with spaces or # need quoting; single quotes keep them literal.
const envValue = (v) => (/[\s#]/.test(v) && !v.includes("'") ? `'${v}'` : v);

function buildEnv(compose) {
  const used = new Set([...compose.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((m) => m[1]));
  const lines = ["# Settings for docker-compose.yml. Keep this file private (it holds passwords).", ""];
  for (const [key, name] of Object.entries(SETTING_VARS)) {
    if (used.has(name)) lines.push(`${name}=${envValue(state.settings[key])}`);
  }
  const secrets = Object.keys(state.secrets).filter((k) => used.has(k));
  if (secrets.length) {
    lines.push("", "# Randomly generated. Change them if you like, before the first start.");
    secrets.forEach((k) => lines.push(`${k}=${state.secrets[k]}`));
  }
  const vars = state.selected.flatMap((id) => Object.entries(APP_BY_ID[id].vars || {})).filter(([k]) => used.has(k));
  if (vars.length) {
    lines.push("", "# Fill these in yourself.");
    vars.forEach(([k, v]) => lines.push(`# ${v.help}`, `${k}=${v.value}`));
  }
  return lines.join("\n") + "\n";
}

function highlight(text, kind) {
  return text.split("\n").map((line) => {
    const e = esc(line);
    if (kind === "setup") {
      if (/^#/.test(line)) return `<span class="k">${e}</span>`;
      return /^ {4}/.test(line) ? `<span class="s">${e}</span>` : e;
    }
    if (/^\s*#/.test(line)) return `<span class="c">${e}</span>`;
    if (kind === "env") {
      const m = e.match(/^([A-Z0-9_]+)=(.*)$/);
      return m ? `<span class="k">${m[1]}</span>=<span class="s">${m[2]}</span>` : e;
    }
    const withComment = e.replace(/(\s#\s.*)$/, '<span class="c">$1</span>');
    const kv = withComment.match(/^(\s*)([A-Za-z0-9_.-]+)(:)(.*)$/);
    if (kv) return `${kv[1]}<span class="k">${kv[2]}</span>${kv[3]}${kv[4].replace(/(&quot;.*?&quot;)/g, '<span class="s">$1</span>')}`;
    return withComment.replace(/(&quot;.*?[^\\]&quot;)/g, '<span class="s">$1</span>');
  }).join("\n");
}

function currentOutput() {
  if (outTab === "setup") return { text: buildSetup(), file: "SETUP.md" };
  const compose = buildCompose();
  return outTab === "compose"
    ? { text: compose, file: "docker-compose.yml" }
    : { text: buildEnv(compose), file: ".env" };
}

function renderOutput() {
  document.querySelectorAll(".out-tab").forEach((t) => {
    t.classList.toggle("on", t.dataset.out === outTab);
    t.setAttribute("aria-selected", t.dataset.out === outTab);
  });
  const { text } = currentOutput();
  $("#output code").innerHTML = highlight(text, outTab);
}

// ---------------------------------------------------------------- builder: links after starting

function renderLinks() {
  const host = state.settings.host.trim() || "your-server-ip";
  const items = state.selected.map((id) => APP_BY_ID[id]).filter((a) => !a.composeUrl || isNative(a)).map((app) => {
    let links;
    if (nativeMode(app) === "script") {
      links = [`<span class="muted">Its own LXC: the helper script prints the address when it finishes.</span>`];
    } else if (nativeMode(app) === "oci") {
      const ui = (servicesOf(app)[0].ports || []).find((p) => /UI|wizard/i.test(p.label));
      links = [`<span class="muted">${ui ? `http://&lt;its LXC IP&gt;:${ui.container}${esc(ui.path || "")}` : "Its own LXC, no web page."}</span>`];
    } else {
      links = servicesOf(app).flatMap((svc) => (svc.ports || []).flatMap((p, i) => {
        if (!/UI|wizard/i.test(p.label)) return [];
        const url = `${p.https ? "https" : "http"}://${host}:${hostPort(app.id, svc, i)}${p.path || ""}`;
        return [`<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>${p.label !== "Web UI" ? ` <span class="muted">(${esc(p.label)})</span>` : ""}`];
      }));
    }
    return `
      <li>
        <strong>${esc(app.name)}</strong>
        <div>${links.join("<br>") || `<span class="muted">No web page. Other apps talk to it.</span>`}</div>
        ${app.note && !app.composeUrl ? `<div class="muted small">${esc(app.note)}</div>` : ""}
      </li>`;
  });
  $("#links").innerHTML = items.length
    ? `<ul class="links">${items.join("")}</ul>`
    : `<div class="empty">Add apps to see where to open them.</div>`;
}

function renderBuilder() {
  $("#deploySelect").innerHTML = Object.entries(TARGETS).map(([id, t]) =>
    `<option value="${id}">${esc(t.label)}</option>`).join("");
  document.querySelectorAll("[data-setting]").forEach((el) => {
    if (el.type === "checkbox") el.checked = Boolean(state.settings[el.dataset.setting]);
    else el.value = state.settings[el.dataset.setting];
  });
  renderCatalog();
  renderSelected();
  renderWarnings();
  renderOutput();
  renderLinks();
  updateCount();
}

// ---------------------------------------------------------------- copy / download

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

async function copyOutput() {
  const { text, file } = currentOutput();
  await copyText(text);
  toast(`Copied ${file}`);
}

async function copyShareLink() {
  if (!state.selected.length) return toast("Add some apps first");
  await copyText(shareUrl());
  toast("Share link copied. Passwords aren't included.");
}

function downloadOutput() {
  const { text, file } = currentOutput();
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: file });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast(`Downloaded ${file}`);
}

// ---------------------------------------------------------------- events

document.addEventListener("click", (ev) => {
  const t = ev.target.closest("button, a");
  if (!t) return;

  if (t.dataset.view) return setView(t.dataset.view);
  if (t.dataset.goto) { ev.preventDefault(); return setView(t.dataset.goto); }

  if (t.dataset.goal) {
    const id = t.dataset.goal;
    state.goals = state.goals.includes(id) ? state.goals.filter((g) => g !== id) : [...state.goals, id];
    save();
    return renderPicker();
  }
  if (t.dataset.level) {
    state.level = Number(t.dataset.level);
    $("#gettingStarted").open = state.level === 1;
    save();
    return renderPicker();
  }
  if (t.dataset.deploy) {
    setTarget(t.dataset.deploy);
    return renderPicker();
  }
  if (t.dataset.toggle) {
    toggleApp(t.dataset.toggle);
    updateCount();
    return state.view === "picker" ? renderResults() : renderBuilder();
  }
  if (t.dataset.remove) {
    const also = removeApp(t.dataset.remove);
    if (also.length) toast(`Also removed ${also.join(", ")}`);
    return renderBuilder();
  }
  if (t.dataset.cat) { catalogFilter.cat = t.dataset.cat; return renderCatalog(); }
  if (t.dataset.out) { ev.preventDefault(); outTab = t.dataset.out; return renderOutput(); }

  switch (t.id) {
    case "addAllBtn": {
      GOALS.filter((g) => state.goals.includes(g.id)).forEach((g) => recommendedFor(g).forEach(addApp));
      return setView("builder");
    }
    case "toggleGoalsBtn": {
      const groups = new Set(GOALS.map((g) => g.group));
      openGoalGroups = openGoalGroups.size === groups.size ? new Set() : groups;
      return renderPicker();
    }
    case "autoFixBtn": return autoFixPorts();
    case "copyBtn": return copyOutput();
    case "downloadBtn": return downloadOutput();
    case "shareBtn": return copyShareLink();
    case "clearBtn":
      state.selected = [];
      state.ports = {};
      save();
      return renderBuilder();
  }
});

// Remember which goal groups and catalog categories are open across re-renders.
document.addEventListener("toggle", (ev) => {
  const { group, goalGroup } = ev.target.dataset || {};
  if (goalGroup) {
    if (ev.target.open) openGoalGroups.add(goalGroup);
    else openGoalGroups.delete(goalGroup);
    $("#toggleGoalsBtn").textContent = openGoalGroups.size === new Set(GOALS.map((g) => g.group)).size ? "Collapse all" : "Expand all";
  }
  if (!group) return;
  if (ev.target.open) catalogFilter.collapsed.delete(group);
  else catalogFilter.collapsed.add(group);
}, true);

document.addEventListener("input", (ev) => {
  const el = ev.target;
  if (el.dataset.setting === "deploy") {
    setTarget(el.value);
    renderBuilder();
  } else if (el.dataset.setting) {
    state.settings[el.dataset.setting] = el.type === "checkbox" ? el.checked : el.value;
    save();
    renderOutput();
    renderLinks();
  } else if (el.dataset.port) {
    const n = parseInt(el.value, 10);
    if (n >= 1 && n <= 65535) state.ports[el.dataset.port] = n;
    save();
    // Update warnings/output without re-rendering the input being typed in.
    renderWarnings();
    renderOutput();
    renderLinks();
    const conflictKeys = new Set([
      ...findConflicts().flatMap(([, es]) => es.map((e) => e.key)),
      ...reservedClashes().map((e) => e.key),
    ]);
    document.querySelectorAll("[data-port]").forEach((inp) =>
      inp.closest(".port").classList.toggle("conflict", conflictKeys.has(inp.dataset.port)));
  } else if (el.id === "search") {
    catalogFilter.q = el.value;
    renderCatalog();
  }
});

// ---------------------------------------------------------------- init

applyShareLink();
$("#gettingStarted").open = state.level === 1;
renderPicker();
updateCount();
setView(state.view);
