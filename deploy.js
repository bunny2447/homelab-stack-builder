// Deployment targets: where the stack will run. Each target can change the default paths/IDs,
// reserve ports its host OS already uses, and writes its own step-by-step SETUP.md.

const HELPER_BASE = "https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main";
const helperCmd = (path) => `bash -c "$(curl -fsSL ${HELPER_BASE}/${path}.sh)"`;
const helperPage = (slug) => `https://community-scripts.github.io/ProxmoxVE/scripts?id=${slug}`;

const TARGETS = {
  docker: {
    icon: "🐧", label: "Linux server or VM", short: "Any Linux machine with Docker (Ubuntu, Debian…)",
  },
  "pve-vm": {
    icon: "🖥️", label: "Proxmox: Docker in a VM", short: "Most compatible. GPU needs PCI passthrough",
  },
  "pve-lxc": {
    icon: "📦", label: "Proxmox: Docker in an LXC", short: "Light on RAM, easy GPU sharing",
  },
  "pve-native": {
    icon: "🧩", label: "Proxmox: one LXC per app (no Docker)",
    short: "Helper scripts, or the app's image run as an LXC",
  },
  synology: {
    icon: "🗄️", label: "Synology NAS", short: "Container Manager",
    defaults: { configRoot: "/volume1/docker", dataRoot: "/volume1/data", puid: "1026", pgid: "100" },
    reserved: { 80: "DSM", 443: "DSM", 5000: "DSM", 5001: "DSM" },
  },
  unraid: {
    icon: "🟧", label: "Unraid", short: "Compose Manager plugin",
    defaults: { configRoot: "/mnt/user/appdata", dataRoot: "/mnt/user/data", puid: "99", pgid: "100" },
    reserved: { 80: "the Unraid web UI", 443: "the Unraid web UI" },
  },
  desktop: {
    icon: "💻", label: "Docker Desktop", short: "Windows or macOS, for trying things out",
    defaults: { configRoot: "./appdata", dataRoot: "./data", host: "localhost" },
  },
};

// ---------------------------------------------------------------- Proxmox LXC per app
// In "pve-native" mode every app gets its own LXC, no Docker:
//   "script": a community helper script installs it natively, or
//   "oci":    Proxmox VE 9.1+ pulls the app's Docker image and runs it directly as an LXC.
// Apps that can't work either way stay in docker-compose.yml for one Docker LXC.

// Why an app's image can't run as a plain LXC, or null if it can.
function ociBlocker(app) {
  if (app.composeUrl || servicesOf(app).length !== 1) return "needs several containers working together";
  const svc = servicesOf(app)[0];
  if ((svc.volumes || []).some((v) => v.includes("docker.sock"))) return "needs access to Docker";
  if (svc.command) return "needs a custom start command";
  if (svc.pid || svc.capAdd || svc.sysctls || svc.devices) return "needs low-level host access";
  return null;
}

function nativeMode(app) {
  if (state.settings.deploy !== "pve-native") return null;
  if (app.lxc) return "script";
  return ociBlocker(app) ? null : "oci";
}
const isNative = (app) => Boolean(nativeMode(app));

// RAM (MB) for image-based LXCs; everything else gets 1 GB.
const LXC_MEMORY = { gitlab: 6144, minecraft: 5120, valheim: 4096, jupyter: 2048, anythingllm: 2048, libretranslate: 2048, calibre: 2048, handbrake: 2048 };

// Docker Hub shorthand ("nginx:alpine", "user/app") -> full reference skopeo/Proxmox accept.
function fullImageRef(image) {
  let ref = image.includes(":") && !image.slice(image.lastIndexOf(":")).includes("/") ? image : `${image}:latest`;
  const first = ref.split("/")[0];
  if (!ref.includes("/")) ref = `docker.io/library/${ref}`;
  else if (!first.includes(".") && !first.includes(":")) ref = `docker.io/${ref}`;
  return ref;
}

const shQuote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

// Replace ${VAR} with the real value: there's no .env file when running without Docker.
function resolveVars(str, app) {
  const values = { ...state.secrets };
  for (const [key, name] of Object.entries(SETTING_VARS)) values[name] = state.settings[key];
  for (const [name, v] of Object.entries(app.vars || {})) values[name] = v.value || "CHANGE-ME";
  return String(str).replace(/\$\{([A-Z0-9_]+)\}/g, (m, name) => values[name] ?? m);
}

function ociCommands(app) {
  const s = state.settings;
  const svc = servicesOf(app)[0];
  // lsio images, user: overrides and images taking PUID-style env all write files as PUID.
  const runsAsPuid = app.lsio || Boolean(svc.user) || Object.values(svc.env || {}).includes("${PUID}");
  const owner = runsAsPuid ? `${100000 + Number(s.puid)}:${100000 + Number(s.pgid)}` : "100000:100000";

  // Only folders under the config/data roots become mount points; system binds don't apply to an LXC.
  const mounts = (svc.volumes || []).map((v) => {
    const [host, target, opts] = resolveVars(v, app).split(":");
    return { host, target, ro: opts === "ro" };
  }).filter((m) => m.host.startsWith(s.configRoot) || m.host.startsWith(s.dataRoot));

  const env = { ...(app.lsio ? { PUID: "${PUID}", PGID: "${PGID}", TZ: "${TZ}" } : {}), ...(svc.env || {}) };
  (svc.ports || []).forEach((p) => { if (p.linkEnv) env[p.linkEnv] = String(p.host); });
  const confLines = Object.entries(env).map(([k, v]) => `lxc.environment.runtime: ${k}=${resolveVars(v, app)}`);
  if (svc.user) {
    const [uid, gid] = resolveVars(svc.user, app).split(":");
    confLines.push(`lxc.init.uid: ${uid}`, `lxc.init.gid: ${gid}`);
  }

  const create = [
    `pct create $CTID $TEMPLATE_STORAGE:vztmpl/${app.id}.tar --hostname ${app.id} --unprivileged 1`,
    `  --cores 2 --memory ${LXC_MEMORY[app.id] || 1024} --rootfs $ROOTFS_STORAGE:8 --net0 name=eth0,bridge=$BRIDGE,ip=dhcp`,
    ...mounts.map((m, i) => `  --mp${i} ${m.host},mp=${m.target}${m.ro ? ",ro=1" : ""}`),
    ...(s.gpu && app.gpu ? ["  --dev0 /dev/dri/renderD128,mode=0666"] : []),
  ];
  const cmds = [
    "CTID=$(pvesh get /cluster/nextid)",
    `pvesm list $TEMPLATE_STORAGE | grep -q 'vztmpl/${app.id}.tar' || pvesh create /nodes/$(hostname)/storage/$TEMPLATE_STORAGE/oci-registry-pull --reference ${fullImageRef(svc.image)} --filename ${app.id}`,
  ];
  if (mounts.length) {
    const writable = mounts.filter((m) => !m.ro).map((m) => m.host);
    cmds.push(`mkdir -p ${mounts.map((m) => m.host).join(" ")}`);
    if (writable.length) cmds.push(`chown ${owner} ${writable.join(" ")}`);
  }
  cmds.push(...create.map((line, i) => (i < create.length - 1 ? `${line} \\` : line)));
  if (confLines.length) cmds.push(`printf '%s\\n' ${confLines.map(shQuote).join(" ")} >> /etc/pve/lxc/$CTID.conf`);
  cmds.push("pct start $CTID && echo \"Started CT $CTID\"");
  return cmds;
}

function setTarget(target) {
  const base = defaultState().settings;
  const oldDefaults = { ...base, ...TARGETS[state.settings.deploy]?.defaults };
  const newDefaults = { ...base, ...TARGETS[target].defaults };
  // Only replace values the user hasn't customised.
  for (const k of ["configRoot", "dataRoot", "puid", "pgid", "host"]) {
    if (state.settings[k] === oldDefaults[k]) state.settings[k] = newDefaults[k];
  }
  state.settings.deploy = target;
  save();
}

// ---------------------------------------------------------------- SETUP.md

function buildSetup() {
  const s = state.settings;
  const t = TARGETS[s.deploy];
  const apps = state.selected.map((id) => APP_BY_ID[id]);
  const native = apps.filter(isNative);
  const dockerApps = apps.filter((a) => !a.composeUrl && !isNative(a));
  const external = apps.filter((a) => a.composeUrl && !isNative(a));
  const services = dockerApps.flatMap(servicesOf);
  const needsTun = services.some((svc) => (svc.devices || []).some((d) => d.startsWith("/dev/net/tun")));
  const needsGpu = s.gpu && dockerApps.some((a) => a.gpu);
  const hostNet = dockerApps.filter((a) => servicesOf(a).some((svc) => svc.hostNetwork));
  const folders = `${s.configRoot} ${s.dataRoot}/media/{movies,tv,music,books,photos} ${s.dataRoot}/torrents ${s.dataRoot}/usenet`;

  const L = [`# Setup guide: ${t.label}`, ""];
  const step = (title) => L.push("", `## ${title}`, "");
  const cmd = (...lines) => L.push(...lines.map((x) => `    ${x}`));
  const folderStep = (sudo = "sudo ") => {
    step("Create the folders");
    cmd(`${sudo}mkdir -p ${folders}`, `${sudo}chown -R ${s.puid}:${s.pgid} ${s.configRoot} ${s.dataRoot}`);
  };
  const startStep = () => {
    step("Start the stack");
    L.push("Put docker-compose.yml and .env together in one folder, then:");
    cmd("mkdir -p ~/homelab && cd ~/homelab", "# copy both files here", "docker compose up -d");
    L.push("", "Check everything is running with `docker compose ps`, and read an app's logs with `docker compose logs <name>`.");
  };
  const updateStep = () => {
    step("Updating later");
    cmd("docker compose pull && docker compose up -d");
  };

  if (!apps.length) return L.concat("Add some apps first.").join("\n") + "\n";

  if (s.deploy === "docker") {
    step("Install Docker");
    cmd("curl -fsSL https://get.docker.com | sh", "sudo usermod -aG docker $USER   # then log out and back in");
    folderStep();
    startStep();
    updateStep();
  }

  if (s.deploy === "pve-vm") {
    step("Create a Docker VM (Proxmox host shell)");
    L.push("This community script creates a Debian VM with Docker already installed:");
    cmd(helperCmd("vm/docker-vm"));
    L.push("", "Or create a Debian/Ubuntu VM yourself and run `curl -fsSL https://get.docker.com | sh` inside it.",
      "Give it at least 4 GB RAM and 2 cores for a typical stack (more for Immich, GitLab or AI apps).");
    step("Get your data into the VM");
    L.push("Option A: add a second virtual disk in Proxmox (VM → Hardware → Add → Hard Disk) and mount it at the data folder.",
      "Option B: mount a share from your NAS or the Proxmox host over NFS:");
    cmd("sudo apt install -y nfs-common", `echo "NAS-IP:/export/data  ${s.dataRoot}  nfs  defaults  0 0" | sudo tee -a /etc/fstab`,
      `sudo mkdir -p ${s.dataRoot} && sudo mount -a`);
    if (needsGpu) {
      L.push("", "GPU transcoding: a VM can only use the GPU through PCI passthrough (VM → Hardware → Add → PCI Device,",
        "with IOMMU enabled on the host). If that's too fiddly, \"Docker in an LXC\" shares the iGPU much more easily.");
    }
    folderStep();
    startStep();
    updateStep();
  }

  if (s.deploy === "pve-lxc" || (s.deploy === "pve-native" && (dockerApps.length || external.length))) {
    if (s.deploy === "pve-native") {
      L.push("", "---", "", "# Apps that need Docker: run them in one Docker LXC",
        `These are in docker-compose.yml: ${dockerApps.map((a) => a.name).join(", ") || "(none)"}.`);
    }
    step("Create a Docker LXC (Proxmox host shell)");
    L.push("This community script creates an LXC with Docker installed and nesting already enabled:");
    cmd(helperCmd("ct/docker"));
    L.push("", "Note the container ID it creates (CTID below, e.g. 101). If you made the LXC yourself, enable nesting:");
    cmd("pct set CTID --features nesting=1,keyctl=1");
    step("Share your data folder from the host (Proxmox host shell)");
    cmd(`pct set CTID -mp0 /path/on/host/data,mp=${s.dataRoot}`);
    L.push("", `Unprivileged LXCs shift user IDs by 100000, so files owned by ${s.puid} inside the LXC are ${100000 + Number(s.puid)} on the host:`);
    cmd(`chown -R ${100000 + Number(s.puid)}:${100000 + Number(s.pgid)} /path/on/host/data`);
    if (needsGpu || needsTun) {
      step("Give the LXC access to devices (Proxmox host shell)");
      L.push("Add these lines to /etc/pve/lxc/CTID.conf, then restart the LXC:");
      if (needsGpu) {
        cmd("dev0: /dev/dri/renderD128,gid=104   # GPU for transcoding (Proxmox 8.2+; 104 = render group in Debian)");
      }
      if (needsTun) {
        cmd("lxc.cgroup2.devices.allow: c 10:200 rwm   # /dev/net/tun for VPN apps",
          "lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file");
      }
    }
    if (dockerApps.some((a) => a.id === "wgeasy")) {
      L.push("", "WireGuard (wg-easy) uses the Proxmox host's kernel module, so nothing extra is needed inside the LXC.");
    }
    L.push("", "Then open the LXC's console (`pct enter CTID`) for the next steps.");
    folderStep("");
    startStep();
    updateStep();
  }

  if (s.deploy === "pve-native") {
    const scripted = native.filter((a) => nativeMode(a) === "script");
    const oci = native.filter((a) => nativeMode(a) === "oci");
    const leftover = apps.filter((a) => !isNative(a));
    const N = [
      "", "Every app below gets its own LXC container. Nothing here needs Docker.",
      `Run all commands in the Proxmox host shell (Datacenter → your node → Shell).`,
    ];
    if (scripted.length) {
      N.push("", `## Apps installed by helper scripts (${scripted.length})`, "",
        "These come from the community-scripts project. Each script asks a few questions (defaults are fine)",
        "and prints the app's address when it finishes. Read a script on its page before running it.");
      for (const a of scripted) {
        N.push("", `### ${a.name}`, "", `    ${helperCmd(`ct/${a.lxc}`)}`, "", `Script page: ${helperPage(a.lxc)}`);
      }
      N.push("", "Media apps (Jellyfin, Plex, Sonarr…) need the same media folder: add it to each of their LXCs with",
        `\`pct set CTID -mp0 ${s.dataRoot},mp=/data\`. The Jellyfin/Plex scripts can set up GPU access for you.`);
    }
    if (oci.length) {
      N.push("", `## Apps run from their image as an LXC (${oci.length})`, "",
        "These apps have no helper script, so Proxmox pulls the app's official container image and runs it",
        "directly as an LXC. This needs Proxmox VE 9.1 or newer, and Proxmox still calls it a technology preview.",
        "", "First, once per shell session (adjust the storage names and bridge to match your Proxmox):");
      N.push("", "    apt install -y skopeo", "    TEMPLATE_STORAGE=local       # storage with \"Container template\" content",
        "    ROOTFS_STORAGE=local-lvm     # storage for container disks", "    BRIDGE=vmbr0");
      for (const a of oci) {
        N.push("", `### ${a.name}`, "", ...ociCommands(a).map((c) => `    ${c}`));
        const ports = servicesOf(a)[0].ports || [];
        const ui = ports.find((p) => /UI|wizard/i.test(p.label));
        N.push("", ui ? `Open it at http://<LXC IP>:${ui.container}${ui.path || ""} (find the IP with \`pct exec $CTID -- ip -4 addr\` or in the LXC's Summary).`
          : `Listens on ${ports.map((p) => `${p.container}${p.proto === "udp" ? "/udp" : ""}`).join(", ") || "no ports"} at the LXC's IP.`);
      }
      N.push("", "Tips for image-based LXCs:",
        "- Apps talk to each other by LXC IP address, not by name (e.g. http://192.168.1.50:11434 instead of http://ollama:11434).",
        `- Unprivileged LXCs shift user IDs by 100000. If an app's note says \`chown 1000:1000\`, use 101000:101000 on the Proxmox host.`,
        "- To update an app: delete its template under the storage's CT Templates, then recreate the LXC with the same mount points.");
      const vars = oci.flatMap((a) => Object.keys(a.vars || {}));
      if (vars.length) N.push(`- Replace CHANGE-ME in the ${vars.join(", ")} line(s) before running those commands.`);
    }
    if (leftover.length) {
      N.push("", `## Apps that still need Docker (${leftover.length})`, "");
      leftover.forEach((a) => N.push(`- ${a.name}: ${ociBlocker(a)}.${a.lxcAlt ? ` ${a.lxcAlt}` : ""}`));
      if (dockerApps.length) N.push("", "These are in docker-compose.yml. Run them in one Docker LXC as described below.");
    }
    // The per-app LXCs go right after the title; the Docker LXC section (if any) follows them.
    L.splice(2, 0, ...N);
  }

  if (s.deploy === "synology") {
    step("Install Container Manager");
    L.push("Package Center → search \"Container Manager\" → Install.");
    step("Create the folders");
    L.push(`In File Station, create ${s.configRoot} (app settings) and ${s.dataRoot} with media and torrents subfolders.`,
      "Or over SSH (Control Panel → Terminal & SNMP → enable SSH):");
    cmd(`sudo mkdir -p ${folders}`);
    L.push("", "Run `id` over SSH to check your PUID/PGID (often 1026 and 100).");
    step("Create the project");
    L.push(`1. Create the folder ${s.configRoot}/homelab and put .env in it (File Station → Upload).`,
      "2. Container Manager → Project → Create. Name: homelab. Path: that folder.",
      "3. Source: \"Upload docker-compose.yml\" (or paste it), then Next → Done. It builds and starts the stack.");
    if (needsGpu) L.push("", "GPU transcoding works on Synology models with an Intel CPU that has Quick Sync (most \"+\" models).");
  }

  if (s.deploy === "unraid") {
    step("Install the Compose plugin");
    L.push("Apps tab (Community Applications) → search \"Docker Compose Manager\" → Install.");
    step("Create the stack");
    L.push("1. Docker tab → scroll to Compose → Add New Stack → name it homelab.",
      "2. Click the gear → Edit Stack → Compose File: paste docker-compose.yml → Save.",
      "3. Gear → Edit Stack → ENV File: paste .env → Save.",
      "4. Click Compose Up.");
    L.push("", `Paths use the standard Unraid shares (${s.configRoot} and ${s.dataRoot}). PUID 99 / PGID 100 is Unraid's nobody:users.`);
    if (needsGpu) L.push("", "GPU transcoding: for an Intel iGPU, install the \"Intel GPU TOP\" plugin first so /dev/dri exists.");
  }

  if (s.deploy === "desktop") {
    L.push("Docker Desktop is great for trying apps out. For a 24/7 homelab, use an always-on Linux machine.");
    step("Install Docker Desktop");
    L.push("Download it from https://www.docker.com/products/docker-desktop/ and start it.");
    step("Start the stack");
    L.push("Make a folder (e.g. Documents/homelab), put docker-compose.yml and .env in it, open a terminal there and run:");
    cmd("docker compose up -d");
    L.push("", "The appdata and data folders are created next to the files. Open apps at http://localhost:PORT.");
    if (hostNet.length || needsGpu) {
      L.push("", "Won't work on Docker Desktop:");
      if (hostNet.length) L.push(`- ${hostNet.map((a) => a.name).join(", ")} (needs host networking on Linux)`);
      if (needsGpu) L.push("- GPU transcoding (/dev/dri only exists on Linux)");
    }
  }

  if (external.length) {
    L.push("", "---", "", "# Set up separately",
      "These apps use their own official compose files (run them next to this stack):");
    external.forEach((a) => L.push(`- ${a.name}: ${a.composeUrl}`));
  }
  return L.join("\n") + "\n";
}
