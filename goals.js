// Goals for the "What should I self-host?" picker, shown under their group heading.
// picks = app ids, best first. bundle = recommend every pick, not just one.

const GOALS = [
  // Media
  { group: "Media", id: "movies",    icon: "🎬", label: "Stream my movies & TV (replace Netflix)", picks: ["jellyfin", "plex", "emby"] },
  { group: "Media", id: "photos",    icon: "📷", label: "Replace Google Photos / iCloud Photos",   picks: ["immich", "photoprism"] },
  { group: "Media", id: "music",     icon: "🎵", label: "Stream my music (replace Spotify)",       picks: ["navidrome", "jellyfin"] },
  { group: "Media", id: "books",     icon: "🎧", label: "Audiobooks & podcasts",                   picks: ["audiobookshelf"] },
  { group: "Media", id: "ebooks",    icon: "📚", label: "Ebooks, comics & manga",                  picks: ["kavita", "calibreweb", "komga"] },
  { group: "Media", id: "youtube",   icon: "📺", label: "Save YouTube videos & channels",          picks: ["pinchflat", "metube"] },
  { group: "Media", id: "channels",  icon: "📡", label: "Make my own live TV channels",            picks: ["ersatztv"] },
  { group: "Media", id: "stream",    icon: "🎥", label: "Live-stream like Twitch",                 picks: ["owncast"] },
  { group: "Media", id: "convert",   icon: "🎞️", label: "Convert & shrink videos",                 picks: ["handbrake"] },
  { group: "Media", id: "plexstats", icon: "📊", label: "Stats for my Plex server",                picks: ["tautulli"] },
  { group: "Media", id: "invite",    icon: "✉️", label: "Invite friends to my media server",       picks: ["wizarr"] },
  { group: "Media", id: "cleanup",   icon: "🧹", label: "Auto-delete media nobody watches",        picks: ["maintainerr"] },

  // Downloads
  { group: "Downloads", id: "automate", icon: "🤖", label: "Auto-download TV & movies",            picks: ["sonarr", "radarr", "prowlarr", "qbittorrent"], bundle: true },
  { group: "Downloads", id: "requests", icon: "🙋", label: "Let family request movies & shows",    picks: ["seerr", "ombi"] },
  { group: "Downloads", id: "subs",     icon: "💬", label: "Get subtitles automatically",          picks: ["bazarr"] },
  { group: "Downloads", id: "musicdl",  icon: "🎼", label: "Auto-download music",                  picks: ["lidarr"] },
  { group: "Downloads", id: "usenet",   icon: "📰", label: "Download from Usenet",                 picks: ["sabnzbd", "nzbget"] },
  { group: "Downloads", id: "vpn",      icon: "🕶️", label: "Hide my torrent traffic behind a VPN", picks: ["gluetun"] },

  // Network & security
  { group: "Network & security", id: "remote",     icon: "🌍", label: "Access my homelab from anywhere",        picks: ["tailscale", "wgeasy", "cloudflared"] },
  { group: "Network & security", id: "ads",        icon: "🛡️", label: "Block ads on my whole network",           picks: ["adguard", "pihole", "technitium"] },
  { group: "Network & security", id: "https",      icon: "🔒", label: "Access apps by domain name with HTTPS",   picks: ["npm", "caddy", "traefik"] },
  { group: "Network & security", id: "passwords",  icon: "🔑", label: "Password manager (replace LastPass/1Password)", picks: ["vaultwarden"] },
  { group: "Network & security", id: "sso",        icon: "🪪", label: "One login for all my apps (SSO)",        picks: ["authelia", "authentik"] },
  { group: "Network & security", id: "twofa",      icon: "🔢", label: "Keep my 2FA codes",                      picks: ["twofauth"] },
  { group: "Network & security", id: "ddns",       icon: "🔁", label: "Keep my domain pointed at home",          picks: ["ddnsupdater"] },
  { group: "Network & security", id: "dns",        icon: "🧭", label: "My own private DNS resolver",             picks: ["unbound"] },
  { group: "Network & security", id: "attacks",    icon: "🚫", label: "Block attackers automatically",           picks: ["crowdsec"] },
  { group: "Network & security", id: "remotedesk", icon: "🖥️", label: "Remote desktop (replace TeamViewer)",     picks: ["rustdesk"] },
  { group: "Network & security", id: "netboot",    icon: "💿", label: "Install operating systems over the network", picks: ["netbootxyz"] },

  // Server management
  { group: "Server management", id: "dashboard", icon: "🏁", label: "A start page for all my services",      picks: ["homepage", "homarr", "heimdall", "homer"] },
  { group: "Server management", id: "monitor",   icon: "📈", label: "Know when something goes down",         picks: ["uptimekuma", "healthchecks"] },
  { group: "Server management", id: "stats",     icon: "🌡️", label: "See CPU, RAM & disk usage",              picks: ["beszel", "glances", "netdata"] },
  { group: "Server management", id: "metrics",   icon: "📉", label: "Metrics & dashboards (Grafana stack)",  picks: ["grafana", "prometheus", "nodeexporter"], bundle: true },
  { group: "Server management", id: "manage",    icon: "🐳", label: "Manage Docker from a web UI",           picks: ["portainer", "dockge", "dozzle"] },
  { group: "Server management", id: "updates",   icon: "🆕", label: "Know when containers have updates",      picks: ["wud"] },
  { group: "Server management", id: "backup",    icon: "💾", label: "Back up my app data",                   picks: ["duplicati"] },
  { group: "Server management", id: "speed",     icon: "⚡", label: "Track my internet speed",                picks: ["speedtest", "librespeed", "smokeping"] },
  { group: "Server management", id: "notify",    icon: "🔔", label: "Push notifications to my phone",        picks: ["ntfy", "gotify"] },

  // Files & documents
  { group: "Files & documents", id: "drive", icon: "☁️", label: "Replace Google Drive / Dropbox",          picks: ["nextcloud", "syncthing", "seafile"] },
  { group: "Files & documents", id: "docs",  icon: "📄", label: "Go paperless: scan & search documents",   picks: ["paperless"] },
  { group: "Files & documents", id: "pdf",   icon: "🧾", label: "Edit & convert PDFs privately",           picks: ["stirlingpdf"] },
  { group: "Files & documents", id: "sign",  icon: "✍️", label: "Sign documents (replace DocuSign)",       picks: ["docuseal"] },
  { group: "Files & documents", id: "files", icon: "🗂️", label: "Browse my server's files in a browser",   picks: ["filebrowser"] },
  { group: "Files & documents", id: "share", icon: "📲", label: "Send files between my devices",           picks: ["pairdrop"] },
  { group: "Files & documents", id: "paste", icon: "📋", label: "Share text & snippets securely",          picks: ["privatebin"] },

  // Notes & productivity
  { group: "Notes & productivity", id: "notes",      icon: "🗒️", label: "Notes (replace Evernote/Notion)",          picks: ["memos", "trilium", "silverbullet", "joplin"] },
  { group: "Notes & productivity", id: "obsidian",   icon: "💎", label: "Sync my Obsidian vault",                   picks: ["couchdb"] },
  { group: "Notes & productivity", id: "wiki",       icon: "📖", label: "A wiki for me or my team",                 picks: ["bookstack", "wikijs", "outline"] },
  { group: "Notes & productivity", id: "tasks",      icon: "✅", label: "To-dos & kanban (replace Trello)",         picks: ["vikunja", "kanboard", "planka"] },
  { group: "Notes & productivity", id: "whiteboard", icon: "🖍️", label: "Whiteboards & diagrams",                   picks: ["excalidraw", "drawio", "affine"] },
  { group: "Notes & productivity", id: "calendar",   icon: "📅", label: "Sync my calendar & contacts",              picks: ["baikal", "radicale"] },
  { group: "Notes & productivity", id: "collab",     icon: "🤝", label: "Edit text together in real time",          picks: ["etherpad"] },
  { group: "Notes & productivity", id: "workflows",  icon: "⚙️", label: "Automate workflows (replace Zapier)",      picks: ["n8n", "nodered"] },
  { group: "Notes & productivity", id: "news",       icon: "🗞️", label: "Read news/blogs without algorithms (RSS)", picks: ["freshrss", "miniflux"] },
  { group: "Notes & productivity", id: "readlater",  icon: "🔖", label: "Read-it-later (replace Pocket)",           picks: ["readeck", "wallabag", "karakeep"] },
  { group: "Notes & productivity", id: "bookmarks",  icon: "⭐", label: "Save & organise bookmarks",                picks: ["linkding", "linkwarden"] },
  { group: "Notes & productivity", id: "archive",    icon: "🏛️", label: "Archive web pages forever",                picks: ["archivebox"] },
  { group: "Notes & productivity", id: "offline",    icon: "🌐", label: "Offline Wikipedia & more",                 picks: ["kiwix"] },
  { group: "Notes & productivity", id: "pagewatch",  icon: "👀", label: "Get alerted when a web page changes",      picks: ["changedetection"] },

  // Home & money
  { group: "Home & money", id: "budget",        icon: "💰", label: "Budgeting (replace YNAB / Mint)", picks: ["actual", "firefly"] },
  { group: "Home & money", id: "invest",        icon: "📈", label: "Track my investments",            picks: ["ghostfolio"] },
  { group: "Home & money", id: "subscriptions", icon: "💳", label: "Track my subscriptions",          picks: ["wallos"] },
  { group: "Home & money", id: "recipes",       icon: "🍲", label: "Recipes & meal planning",         picks: ["mealie", "tandoor"] },
  { group: "Home & money", id: "groceries",     icon: "🛒", label: "Shared grocery lists & pantry",   picks: ["kitchenowl", "grocy"] },
  { group: "Home & money", id: "inventory",     icon: "📦", label: "Home inventory & warranties",     picks: ["homebox"] },
  { group: "Home & money", id: "gps",           icon: "📍", label: "Track my location or car",        picks: ["traccar"] },

  // Smart home
  { group: "Smart home", id: "smarthome", icon: "🏠", label: "Smart home control",                        picks: ["homeassistant", "homebridge"] },
  { group: "Smart home", id: "zigbee",    icon: "📶", label: "Use Zigbee devices without their hubs",     picks: ["zigbee2mqtt"] },
  { group: "Smart home", id: "esphome",   icon: "🔌", label: "Build my own sensors (ESPHome)",            picks: ["esphome"] },
  { group: "Smart home", id: "voice",     icon: "🗣️", label: "Local voice assistant for Home Assistant", picks: ["whisper", "piper"], bundle: true },
  { group: "Smart home", id: "matter",    icon: "🧩", label: "Matter devices in Home Assistant",          picks: ["matterserver"] },
  { group: "Smart home", id: "cameras",   icon: "📹", label: "Security cameras with AI detection",        picks: ["frigate"] },

  // AI & dev
  { group: "AI & dev", id: "ai",        icon: "🧠", label: "Run my own private ChatGPT",        picks: ["openwebui", "anythingllm"] },
  { group: "AI & dev", id: "search",    icon: "🔍", label: "Private search engine",              picks: ["searxng"] },
  { group: "AI & dev", id: "translate", icon: "🈯", label: "Private translation",                picks: ["libretranslate"] },
  { group: "AI & dev", id: "git",       icon: "🌱", label: "Host my own code (replace GitHub)",  picks: ["gitea", "forgejo", "gitlab"] },
  { group: "AI & dev", id: "ide",       icon: "💻", label: "VS Code in my browser",              picks: ["codeserver"] },
  { group: "AI & dev", id: "notebooks", icon: "🐍", label: "Python notebooks",                   picks: ["jupyter"] },
  { group: "AI & dev", id: "ci",        icon: "🏗️", label: "CI/CD pipelines",                    picks: ["jenkins"] },
  { group: "AI & dev", id: "dbadmin",   icon: "🗄️", label: "Manage databases in a browser",      picks: ["adminer", "pgadmin"] },
  { group: "AI & dev", id: "images",    icon: "📦", label: "Private Docker image registry",     picks: ["registry"] },
  { group: "AI & dev", id: "mailtest",  icon: "📧", label: "Catch test emails from my apps",    picks: ["mailpit"] },
  { group: "AI & dev", id: "tools",     icon: "🧰", label: "Handy dev & IT tools",               picks: ["ittools", "cyberchef"] },

  // Social & fun
  { group: "Social & fun", id: "website",   icon: "🌐", label: "Host a website or blog",               picks: ["wordpress", "ghost", "nginx"] },
  { group: "Social & fun", id: "chat",      icon: "💬", label: "Team or family chat (replace Slack)",  picks: ["mattermost", "synapse"] },
  { group: "Social & fun", id: "fedi",      icon: "🐘", label: "My own Mastodon-style social server",  picks: ["gotosocial"] },
  { group: "Social & fun", id: "voicechat", icon: "🎙️", label: "Voice chat for gaming",                picks: ["mumble", "teamspeak"] },
  { group: "Social & fun", id: "irc",       icon: "⌨️", label: "Always-on IRC client",                 picks: ["thelounge"] },
  { group: "Social & fun", id: "games",     icon: "🎮", label: "Host a game server",                   picks: ["minecraft", "valheim"] },
];

// The catalog's "Top 10" section: popular, well-supported apps most homelabs start with.
const TOP_PICKS = ["jellyfin", "immich", "vaultwarden", "adguard", "tailscale", "npm", "homepage", "uptimekuma", "paperless", "dockge"];

// Display order for catalog categories; any category not listed goes at the end.
const CATEGORY_ORDER = [
  "Media", "Downloads", "Network", "Security", "Management", "Monitoring", "Notifications", "Productivity",
  "Notes & Wiki", "Bookmarks & Reading", "Finance", "Home", "Smart Home", "AI", "Dev", "Communication", "Web", "Games",
];
