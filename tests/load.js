// Loads the site's scripts into a sandbox with a minimal fake DOM, so tests can call the real code.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SCRIPTS = ["apps.js", "apps-more.js", "goals.js", "deploy.js", "app.js"];

// Exported from the page's global scope for tests to use.
const EXPORTS = [
  "addApp", "removeApp", "buildCompose", "buildEnv", "buildSetup", "findConflicts", "reservedClashes",
  "autoFixPorts", "setTarget", "recommendedFor", "renderPicker", "renderBuilder", "nativeMode", "ociBlocker",
  "fullImageRef", "ociCommands", "allPorts", "hostPort", "APPS", "GOALS", "TOP_PICKS", "APP_BY_ID", "TARGETS",
];

function loadSite() {
  const fakeEl = () => ({
    innerHTML: "", textContent: "", value: "", hidden: false, open: false,
    classList: { toggle() {} }, setAttribute() {}, closest: () => fakeEl(),
  });
  const els = {};
  const ctx = {
    console, Intl, URL, Blob, btoa, setTimeout, clearTimeout,
    crypto: require("crypto").webcrypto,
    localStorage: { getItem: () => null, setItem() {} },
    location: { hash: "", href: "file:///index.html" },
    history: { replaceState() {} },
    window: { scrollTo() {} },
    document: {
      documentElement: { dataset: {} },
      querySelector: (s) => (els[s] ||= fakeEl()), querySelectorAll: () => [], addEventListener() {},
    },
  };
  vm.createContext(ctx);
  const src = SCRIPTS.map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n");
  vm.runInContext(`${src}
;globalThis.__site = { get state() { return state; }, ${EXPORTS.join(", ")} };`, ctx);
  return ctx.__site;
}

// Selects exactly these apps (plus their requirements) on a fresh stack.
function selectApps(site, ids) {
  site.state.selected = [];
  site.state.ports = {};
  ids.forEach(site.addApp);
}

module.exports = { loadSite, selectApps, ROOT };
