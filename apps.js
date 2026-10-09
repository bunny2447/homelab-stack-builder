// App catalog + goals used by both the picker and the compose builder.
//
// App fields:
//   difficulty: 1 = beginner, 2 = intermediate, 3 = advanced
//   lsio:       linuxserver.io image -> gets PUID/PGID/TZ env automatically
//   secrets:    env vars that get a random value generated in .env
//   vars:       env vars the user fills in themselves -> { NAME: { value: "default", help: "how to get it" } }
//   composeUrl: app is too complex to template well -> it can be added to the stack as a reminder,
//               but the user sets it up from the official compose file instead
//   gpu:        gets /dev/dri passed through when "Intel/AMD GPU" is turned on in settings
//   requires:   other app ids that get added automatically with this one
//   vpn:        routed through Gluetun (network_mode: service:gluetun) when Gluetun is in the stack
//   lxc:        Proxmox community helper-script name (ct/<lxc>.sh), used for "one LXC per app"
//   lxcAlt:     no-Docker alternative shown when the app can't run as a plain LXC
//   ports[].fixed:   port must stay as-is (e.g. DNS on 53), never auto-moved
//   ports[].https:   web UI is served over HTTPS (used for the links list)
//   ports[].path:    path to append to the web UI link (e.g. /admin)
//   ports[].linkEnv: container port must equal host port and is also written to this env var
//   ports[].label:   ports labelled "...UI" or "...wizard" are shown in the links list
//   service.hostNetwork: uses network_mode: host; ports listed only for conflict checks and links
//   service.capAdd / devices / sysctls / depends / command / user: passed straight through to compose

const APPS = [
  // ---------- Media ----------
  {
    id: "jellyfin", lxc: "jellyfin", name: "Jellyfin", category: "Media", difficulty: 1, gpu: true,
    desc: "Free, open-source media server for movies, TV and music.",
    docs: "https://jellyfin.org/docs/",
    services: [{
      name: "jellyfin", image: "jellyfin/jellyfin:latest",
      user: "${PUID}:${PGID}",
      ports: [{ host: 8096, container: 8096, label: "Web UI" }],
      env: { TZ: "${TZ}" },
      volumes: ["${CONFIG_ROOT}/jellyfin/config:/config", "${CONFIG_ROOT}/jellyfin/cache:/cache", "${DATA_ROOT}/media:/data/media:ro"],
    }],
  },
  {
    id: "plex", lxc: "plex", name: "Plex", category: "Media", difficulty: 1, lsio: true, gpu: true,
    desc: "Polished media server with great apps on every TV. Some features need Plex Pass.",
    docs: "https://support.plex.tv/",
    note: "Get a claim token from plex.tv/claim (valid 4 minutes) and put it in PLEX_CLAIM in .env right before the first start.",
    vars: { PLEX_CLAIM: { value: "", help: "From https://plex.tv/claim. Only needed on the first start." } },
    services: [{
      name: "plex", image: "lscr.io/linuxserver/plex:latest",
      ports: [{ host: 32400, container: 32400, label: "Web UI", path: "/web" }],
      env: { VERSION: "docker", PLEX_CLAIM: "${PLEX_CLAIM}" },
      volumes: ["${CONFIG_ROOT}/plex:/config", "${DATA_ROOT}/media:/data/media"],
    }],
  },
  {
    id: "navidrome", lxc: "navidrome", name: "Navidrome", category: "Media", difficulty: 1,
    desc: "Lightweight music streaming server, works with Subsonic apps.",
    docs: "https://www.navidrome.org/docs/",
    services: [{
      name: "navidrome", image: "deluan/navidrome:latest",
      user: "${PUID}:${PGID}",
      ports: [{ host: 4533, container: 4533, label: "Web UI" }],
      volumes: ["${CONFIG_ROOT}/navidrome:/data", "${DATA_ROOT}/media/music:/music:ro"],
    }],
  },
  {
    id: "audiobookshelf", lxc: "audiobookshelf", name: "Audiobookshelf", category: "Media", difficulty: 1,
    desc: "Audiobook and podcast server with progress sync and mobile apps.",
    docs: "https://www.audiobookshelf.org/docs",
    services: [{
      name: "audiobookshelf", image: "ghcr.io/advplyr/audiobookshelf:latest",
      ports: [{ host: 13378, container: 80, label: "Web UI" }],
      env: { TZ: "${TZ}" },
      volumes: [
        "${DATA_ROOT}/media/audiobooks:/audiobooks", "${DATA_ROOT}/media/podcasts:/podcasts",
        "${CONFIG_ROOT}/audiobookshelf/config:/config", "${CONFIG_ROOT}/audiobookshelf/metadata:/metadata",
      ],
    }],
  },
  {
    id: "kavita", lxc: "kavita", name: "Kavita", category: "Media", difficulty: 1,
    desc: "Reader for ebooks, comics and manga, in the browser or any OPDS app.",
    docs: "https://wiki.kavitareader.com/",
    services: [{
      name: "kavita", image: "jvmilazz0/kavita:latest",
      ports: [{ host: 5000, container: 5000, label: "Web UI" }],
      env: { TZ: "${TZ}" },
      volumes: ["${CONFIG_ROOT}/kavita:/kavita/config", "${DATA_ROOT}/media/books:/books"],
    }],
  },
  {
    id: "immich", lxc: "immich", name: "Immich", category: "Media", difficulty: 2,
    desc: "Google Photos replacement: phone backup, face recognition, map, shared albums.",
    docs: "https://immich.app/docs/install/docker-compose",
    composeUrl: "https://immich.app/docs/install/docker-compose",
    note: "Immich has several containers (server, ML, database, cache) whose versions must match. Use its official compose file.",
  },

  // ---------- Downloads / *arr ----------
  {
    id: "sonarr", lxc: "sonarr", name: "Sonarr", category: "Downloads", difficulty: 2, lsio: true,
    desc: "Automatically finds, downloads and organises TV shows.",
    docs: "https://wiki.servarr.com/sonarr",
    note: "Use /data/torrents as the download path and /data/media/tv as the root folder, so imports are instant hardlinks.",
    services: [{
      name: "sonarr", image: "lscr.io/linuxserver/sonarr:latest",
      ports: [{ host: 8989, container: 8989, label: "Web UI" }],
      volumes: ["${CONFIG_ROOT}/sonarr:/config", "${DATA_ROOT}:/data"],
    }],
  },
  {
    id: "radarr", lxc: "radarr", name: "Radarr", category: "Downloads", difficulty: 2, lsio: true,
    desc: "Like Sonarr, but for movies.",
    docs: "https://wiki.servarr.com/radarr",
    note: "Use /data/media/movies as the root folder.",
    services: [{
      name: "radarr", image: "lscr.io/linuxserver/radarr:latest",
      ports: [{ host: 7878, container: 7878, label: "Web UI" }],
      volumes: ["${CONFIG_ROOT}/radarr:/config", "${DATA_ROOT}:/data"],
    }],
  },
  {
    id: "lidarr", lxc: "lidarr", name: "Lidarr", category: "Downloads", difficulty: 2, lsio: true,
    desc: "Like Sonarr, but for music.",
    docs: "https://wiki.servarr.com/lidarr",
    note: "Use /data/media/music as the root folder.",
    services: [{
      name: "lidarr", image: "lscr.io/linuxserver/lidarr:latest",
      ports: [{ host: 8686, container: 8686, label: "Web UI" }],
      volumes: ["${CONFIG_ROOT}/lidarr:/config", "${DATA_ROOT}:/data"],
    }],
  },
  {
    id: "bazarr", lxc: "bazarr", name: "Bazarr", category: "Downloads", difficulty: 2, lsio: true,
    desc: "Fetches subtitles for everything Sonarr and Radarr download.",
    docs: "https://wiki.bazarr.media/",
    services: [{
      name: "bazarr", image: "lscr.io/linuxserver/bazarr:latest",
      ports: [{ host: 6767, container: 6767, label: "Web UI" }],
      volumes: ["${CONFIG_ROOT}/bazarr:/config", "${DATA_ROOT}:/data"],
    }],
  },
  {
    id: "prowlarr", lxc: "prowlarr", name: "Prowlarr", category: "Downloads", difficulty: 2, lsio: true,
    desc: "Manages indexers once and syncs them to Sonarr and Radarr.",
    docs: "https://wiki.servarr.com/prowlarr",
    services: [{
      name: "prowlarr", image: "lscr.io/linuxserver/prowlarr:latest",
      ports: [{ host: 9696, container: 9696, label: "Web UI" }],
      volumes: ["${CONFIG_ROOT}/prowlarr:/config"],
    }],
  },
  {
    id: "seerr", lxc: "seerr", name: "Seerr", category: "Downloads", difficulty: 1,
    desc: "Netflix-style page where family and friends can request movies and shows (formerly Jellyseerr/Overseerr).",
    docs: "https://github.com/seerr-team/seerr",
    note: "Connects to Jellyfin/Plex for logins and sends requests to Sonarr and Radarr.",
    services: [{
      name: "seerr", image: "ghcr.io/seerr-team/seerr:latest",
      ports: [{ host: 5055, container: 5055, label: "Web UI" }],
      env: { TZ: "${TZ}" },
      volumes: ["${CONFIG_ROOT}/seerr:/app/config"],
    }],
  },
  {
    id: "qbittorrent", lxc: "qbittorrent", name: "qBittorrent", category: "Downloads", difficulty: 1, lsio: true, vpn: true,
    desc: "Torrent client with a web UI.",
    docs: "https://docs.linuxserver.io/images/docker-qbittorrent/",
    note: "The temporary admin password is printed in the logs on first start (docker logs qbittorrent). Set the default save path to /data/torrents.",
    services: [{
      name: "qbittorrent", image: "lscr.io/linuxserver/qbittorrent:latest",
      ports: [
        { host: 8080, container: 8080, label: "Web UI", linkEnv: "WEBUI_PORT" },
        { host: 6881, container: 6881, label: "Torrent (TCP)" },
        { host: 6881, container: 6881, proto: "udp", label: "Torrent (UDP)" },
      ],
      env: { TORRENTING_PORT: "6881" },
      volumes: ["${CONFIG_ROOT}/qbittorrent:/config", "${DATA_ROOT}/torrents:/data/torrents"],
    }],
  },
  {
    id: "gluetun", lxc: "gluetun", name: "Gluetun", category: "Downloads", difficulty: 3,
    desc: "VPN client container. qBittorrent's traffic is routed through it automatically.",
    docs: "https://github.com/qdm12/gluetun-wiki",
    note: "Fill in your VPN provider details in .env. If the VPN drops, qBittorrent loses internet instead of leaking your IP.",
    vars: {
      VPN_SERVICE_PROVIDER: { value: "", help: "e.g. mullvad, protonvpn, airvpn. See the Gluetun wiki for the list." },
      WIREGUARD_PRIVATE_KEY: { value: "", help: "WireGuard private key from your VPN provider's config file." },
      VPN_SERVER_COUNTRIES: { value: "", help: "Optional, e.g. Netherlands" },
    },
    services: [{
      name: "gluetun", image: "ghcr.io/qdm12/gluetun:latest",
      capAdd: ["NET_ADMIN"],
      devices: ["/dev/net/tun:/dev/net/tun"],
      env: {
        TZ: "${TZ}", VPN_SERVICE_PROVIDER: "${VPN_SERVICE_PROVIDER}", VPN_TYPE: "wireguard",
        WIREGUARD_PRIVATE_KEY: "${WIREGUARD_PRIVATE_KEY}", SERVER_COUNTRIES: "${VPN_SERVER_COUNTRIES}",
      },
      volumes: ["${CONFIG_ROOT}/gluetun:/gluetun"],
    }],
  },

  // ---------- Network ----------
  {
    id: "pihole", lxc: "pihole", name: "Pi-hole", category: "Network", difficulty: 1,
    desc: "Network-wide ad and tracker blocking via DNS.",
    docs: "https://docs.pi-hole.net/docker/",
    secrets: ["PIHOLE_PASSWORD"],
    note: "Point your router's DNS at this server. The admin password is PIHOLE_PASSWORD in .env.",
    services: [{
      name: "pihole", image: "pihole/pihole:latest",
      ports: [
        { host: 53, container: 53, label: "DNS (TCP)", fixed: true },
        { host: 53, container: 53, proto: "udp", label: "DNS (UDP)", fixed: true },
        { host: 8053, container: 80, label: "Web UI", path: "/admin" },
      ],
      env: { TZ: "${TZ}", FTLCONF_webserver_api_password: "${PIHOLE_PASSWORD}", FTLCONF_dns_listeningMode: "all" },
      volumes: ["${CONFIG_ROOT}/pihole:/etc/pihole"],
    }],
  },
  {
    id: "adguard", lxc: "adguard", name: "AdGuard Home", category: "Network", difficulty: 1,
    desc: "Ad blocking DNS with a modern UI and built-in DNS-over-HTTPS.",
    docs: "https://github.com/AdguardTeam/AdGuardHome/wiki/Docker",
    note: "Open the setup wizard first and set the web UI to port 80 inside the wizard. After that, use the Web UI link.",
    services: [{
      name: "adguardhome", image: "adguard/adguardhome:latest",
      ports: [
        { host: 53, container: 53, label: "DNS (TCP)", fixed: true },
        { host: 53, container: 53, proto: "udp", label: "DNS (UDP)", fixed: true },
        { host: 3003, container: 3000, label: "Setup wizard" },
        { host: 8083, container: 80, label: "Web UI" },
      ],
      volumes: ["${CONFIG_ROOT}/adguard/work:/opt/adguardhome/work", "${CONFIG_ROOT}/adguard/conf:/opt/adguardhome/conf"],
    }],
  },
  {
    id: "npm", lxc: "nginxproxymanager", name: "Nginx Proxy Manager", category: "Network", difficulty: 2,
    desc: "Reverse proxy with a web UI and free Let's Encrypt HTTPS certificates.",
    docs: "https://nginxproxymanager.com/guide/",
    note: "You set the admin login on first visit. Other apps in this stack can be reached by their service name (e.g. http://vaultwarden:80).",
    services: [{
      name: "nginx-proxy-manager", image: "jc21/nginx-proxy-manager:latest",
      ports: [
        { host: 80, container: 80, label: "HTTP", fixed: true },
        { host: 443, container: 443, label: "HTTPS", fixed: true },
        { host: 81, container: 81, label: "Admin UI" },
      ],
      volumes: ["${CONFIG_ROOT}/npm/data:/data", "${CONFIG_ROOT}/npm/letsencrypt:/etc/letsencrypt"],
    }],
  },
  {
    id: "tailscale", name: "Tailscale", category: "Network", difficulty: 1,
    lxcAlt: "Or skip Docker: install Tailscale on the Proxmox host itself (curl -fsSL https://tailscale.com/install.sh | sh, then tailscale up).",
    desc: "Reach your homelab securely from anywhere, with no port forwarding.",
    docs: "https://tailscale.com/kb/1282/docker",
    note: "Create an auth key at login.tailscale.com/admin/settings/keys and put it in TS_AUTHKEY. Your server then appears in your tailnet as \"homelab\".",
    vars: { TS_AUTHKEY: { value: "", help: "From https://login.tailscale.com/admin/settings/keys" } },
    services: [{
      name: "tailscale", image: "tailscale/tailscale:latest",
      hostNetwork: true,
      capAdd: ["NET_ADMIN", "SYS_MODULE"],
      devices: ["/dev/net/tun:/dev/net/tun"],
      env: { TS_AUTHKEY: "${TS_AUTHKEY}", TS_HOSTNAME: "homelab", TS_STATE_DIR: "/var/lib/tailscale", TS_USERSPACE: "false" },
      volumes: ["${CONFIG_ROOT}/tailscale:/var/lib/tailscale"],
    }],
  },
  {
    id: "wgeasy", name: "WireGuard (wg-easy)", category: "Network", difficulty: 2,
    lxcAlt: "Or use the WireGuard helper script instead (WireGuard with the WGDashboard web UI): bash -c \"$(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/wireguard.sh)\"",
    desc: "Your own VPN server with a web UI and QR codes for phones.",
    docs: "https://wg-easy.github.io/wg-easy/latest/",
    note: "Forward UDP port 51820 on your router to this server. Finish setup in the web UI. INSECURE=true allows the UI over plain HTTP; turn it off once it's behind HTTPS.",
    services: [{
      name: "wg-easy", image: "ghcr.io/wg-easy/wg-easy:15",
      ports: [
        { host: 51820, container: 51820, proto: "udp", label: "WireGuard", fixed: true },
        { host: 51821, container: 51821, label: "Web UI" },
      ],
      capAdd: ["NET_ADMIN", "SYS_MODULE"],
      sysctls: ["net.ipv4.ip_forward=1", "net.ipv4.conf.all.src_valid_mark=1"],
      env: { INSECURE: "true" },
      volumes: ["${CONFIG_ROOT}/wg-easy:/etc/wireguard", "/lib/modules:/lib/modules:ro"],
    }],
  },

  // ---------- Management & monitoring ----------
  {
    id: "portainer", name: "Portainer", category: "Management", difficulty: 1,
    lxcAlt: "Only useful if you run Docker. Proxmox's own web UI already manages your LXCs.",
    desc: "Web UI for managing Docker containers, images and stacks.",
    docs: "https://docs.portainer.io/",
    note: "Create the admin account within 5 minutes of the first start, or restart the container.",
    services: [{
      name: "portainer", image: "portainer/portainer-ce:lts",
      ports: [{ host: 9443, container: 9443, label: "Web UI", https: true }],
      volumes: ["/var/run/docker.sock:/var/run/docker.sock", "${CONFIG_ROOT}/portainer:/data"],
    }],
  },
  {
    id: "dozzle", name: "Dozzle", category: "Management", difficulty: 1,
    lxcAlt: "Only useful if you run Docker. For LXCs, use each container's console in Proxmox.",
    desc: "Live view of all your container logs in the browser.",
    docs: "https://dozzle.dev/guide/getting-started",
    services: [{
      name: "dozzle", image: "amir20/dozzle:latest",
      ports: [{ host: 8888, container: 8080, label: "Web UI" }],
      volumes: ["/var/run/docker.sock:/var/run/docker.sock:ro"],
    }],
  },
  {
    id: "uptimekuma", lxc: "uptimekuma", name: "Uptime Kuma", category: "Management", difficulty: 1,
    desc: "Monitors your services and alerts you (Discord, Telegram, email...) when they go down.",
    docs: "https://github.com/louislam/uptime-kuma/wiki",
    services: [{
      name: "uptime-kuma", image: "louislam/uptime-kuma:1",
      ports: [{ host: 3001, container: 3001, label: "Web UI" }],
      volumes: ["${CONFIG_ROOT}/uptime-kuma:/app/data"],
    }],
  },
  {
    id: "grafana", lxc: "grafana", name: "Grafana", category: "Management", difficulty: 3,
    desc: "Dashboards and graphs. Pair it with Prometheus or InfluxDB for metrics.",
    docs: "https://grafana.com/docs/grafana/latest/setup-grafana/installation/docker/",
    secrets: ["GRAFANA_ADMIN_PASSWORD"],
    note: "Log in as admin with GRAFANA_ADMIN_PASSWORD from .env. Grafana needs a data source (e.g. Prometheus) to be useful.",
    services: [{
      name: "grafana", image: "grafana/grafana-oss:latest",
      user: "${PUID}:${PGID}",
      ports: [{ host: 3030, container: 3000, label: "Web UI" }],
      env: { GF_SECURITY_ADMIN_PASSWORD: "${GRAFANA_ADMIN_PASSWORD}" },
      volumes: ["${CONFIG_ROOT}/grafana:/var/lib/grafana"],
    }],
  },
  {
    id: "homepage", lxc: "homepage", name: "Homepage", category: "Management", difficulty: 2,
    desc: "Start page dashboard with links and live widgets for all your services.",
    docs: "https://gethomepage.dev/",
    note: "Configured with YAML files in the config folder. HOMEPAGE_ALLOWED_HOSTS is set to * (allow all). Tighten it if exposed.",
    services: [{
      name: "homepage", image: "ghcr.io/gethomepage/homepage:latest",
      ports: [{ host: 3000, container: 3000, label: "Web UI" }],
      env: { HOMEPAGE_ALLOWED_HOSTS: "*" },
      volumes: ["${CONFIG_ROOT}/homepage:/app/config", "/var/run/docker.sock:/var/run/docker.sock:ro"],
    }],
  },
  {
    id: "duplicati", lxc: "duplicati", name: "Duplicati", category: "Management", difficulty: 2, lsio: true,
    desc: "Encrypted, scheduled backups of your app data to the cloud or another disk.",
    docs: "https://docs.duplicati.com/",
    secrets: ["DUPLICATI_SETTINGS_KEY", "DUPLICATI_PASSWORD"],
    note: "Your app config folder is mounted read-only at /source/appdata. Back it up somewhere off this server (cloud, NAS). The web UI password is DUPLICATI_PASSWORD in .env.",
    services: [{
      name: "duplicati", image: "lscr.io/linuxserver/duplicati:latest",
      ports: [{ host: 8200, container: 8200, label: "Web UI" }],
      env: { SETTINGS_ENCRYPTION_KEY: "${DUPLICATI_SETTINGS_KEY}", DUPLICATI__WEBSERVICE_PASSWORD: "${DUPLICATI_PASSWORD}" },
      volumes: ["${CONFIG_ROOT}/duplicati:/config", "${CONFIG_ROOT}:/source/appdata:ro", "${DATA_ROOT}/backups:/backups"],
    }],
  },

  // ---------- Productivity / files ----------
  {
    id: "nextcloud", name: "Nextcloud", category: "Productivity", difficulty: 2,
    lxcAlt: "Or use the NextCloudPi helper script: bash -c \"$(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/nextcloudpi.sh)\"",
    desc: "Google Drive / Dropbox replacement: files, calendar, contacts and more.",
    docs: "https://github.com/nextcloud/docker",
    secrets: ["NEXTCLOUD_DB_PASSWORD", "NEXTCLOUD_DB_ROOT_PASSWORD"],
    note: "Includes a MariaDB database. On first visit, create your admin account. The database fields are pre-filled.",
    services: [
      {
        name: "nextcloud", image: "nextcloud:latest",
        ports: [{ host: 8081, container: 80, label: "Web UI" }],
        env: {
          MYSQL_HOST: "nextcloud-db", MYSQL_DATABASE: "nextcloud",
          MYSQL_USER: "nextcloud", MYSQL_PASSWORD: "${NEXTCLOUD_DB_PASSWORD}",
        },
        volumes: ["${CONFIG_ROOT}/nextcloud/html:/var/www/html"],
        depends: ["nextcloud-db"],
      },
      {
        name: "nextcloud-db", image: "mariadb:11",
        command: "--transaction-isolation=READ-COMMITTED --binlog-format=ROW",
        env: {
          MYSQL_ROOT_PASSWORD: "${NEXTCLOUD_DB_ROOT_PASSWORD}", MYSQL_DATABASE: "nextcloud",
          MYSQL_USER: "nextcloud", MYSQL_PASSWORD: "${NEXTCLOUD_DB_PASSWORD}",
        },
        volumes: ["${CONFIG_ROOT}/nextcloud/db:/var/lib/mysql"],
      },
    ],
  },
  {
    id: "syncthing", lxc: "syncthing", name: "Syncthing", category: "Productivity", difficulty: 1, lsio: true,
    desc: "Peer-to-peer folder sync between your devices. No cloud involved.",
    docs: "https://docs.syncthing.net/",
    services: [{
      name: "syncthing", image: "lscr.io/linuxserver/syncthing:latest",
      ports: [
        { host: 8384, container: 8384, label: "Web UI" },
        { host: 22000, container: 22000, label: "Sync (TCP)" },
        { host: 22000, container: 22000, proto: "udp", label: "Sync (UDP)" },
        { host: 21027, container: 21027, proto: "udp", label: "Discovery" },
      ],
      volumes: ["${CONFIG_ROOT}/syncthing/config:/config", "${CONFIG_ROOT}/syncthing/data:/data1"],
    }],
  },
  {
    id: "paperless", lxc: "paperless-ngx", name: "Paperless-ngx", category: "Productivity", difficulty: 2,
    desc: "Scan, OCR and search all your paper documents.",
    docs: "https://docs.paperless-ngx.com/setup/",
    composeUrl: "https://docs.paperless-ngx.com/setup/#docker",
    note: "Needs Redis plus a database and has several setup variants. Use the official compose files.",
  },
  {
    id: "stirlingpdf", lxc: "stirling-pdf", name: "Stirling-PDF", category: "Productivity", difficulty: 1,
    desc: "Merge, split, compress, convert and OCR PDFs locally, without uploading them anywhere.",
    docs: "https://docs.stirlingpdf.com/",
    services: [{
      name: "stirling-pdf", image: "stirlingtools/stirling-pdf:latest",
      ports: [{ host: 8090, container: 8080, label: "Web UI" }],
      volumes: ["${CONFIG_ROOT}/stirling-pdf/configs:/configs", "${CONFIG_ROOT}/stirling-pdf/tessdata:/usr/share/tessdata"],
    }],
  },
  {
    id: "vaultwarden", lxc: "vaultwarden", name: "Vaultwarden", category: "Productivity", difficulty: 2,
    desc: "Lightweight Bitwarden-compatible password manager server.",
    docs: "https://github.com/dani-garcia/vaultwarden/wiki",
    note: "Browsers only allow the web vault over HTTPS, so put it behind a reverse proxy (e.g. Nginx Proxy Manager). After creating your account, set VAULTWARDEN_SIGNUPS_ALLOWED=false in .env and run docker compose up -d.",
    vars: { VAULTWARDEN_SIGNUPS_ALLOWED: { value: "true", help: "Set to false once you've created your account, so strangers can't sign up." } },
    services: [{
      name: "vaultwarden", image: "vaultwarden/server:latest",
      ports: [{ host: 8222, container: 80, label: "Web UI" }],
      env: { SIGNUPS_ALLOWED: "${VAULTWARDEN_SIGNUPS_ALLOWED}" },
      volumes: ["${CONFIG_ROOT}/vaultwarden:/data"],
    }],
  },
  {
    id: "actual", lxc: "actualbudget", name: "Actual Budget", category: "Productivity", difficulty: 1,
    desc: "Fast, private envelope-budgeting app (a YNAB alternative).",
    docs: "https://actualbudget.org/docs/install/docker",
    note: "Browsers need HTTPS for Actual unless you open it on the server itself. Use a reverse proxy or Tailscale HTTPS.",
    services: [{
      name: "actual", image: "actualbudget/actual-server:latest",
      ports: [{ host: 5006, container: 5006, label: "Web UI" }],
      volumes: ["${CONFIG_ROOT}/actual:/data"],
    }],
  },
  {
    id: "mealie", lxc: "mealie", name: "Mealie", category: "Productivity", difficulty: 1,
    desc: "Recipe manager. Import recipes from any URL and plan meals.",
    docs: "https://docs.mealie.io/",
    services: [{
      name: "mealie", image: "ghcr.io/mealie-recipes/mealie:latest",
      ports: [{ host: 9925, container: 9000, label: "Web UI" }],
      env: { TZ: "${TZ}", PUID: "${PUID}", PGID: "${PGID}", ALLOW_SIGNUP: "false" },
      volumes: ["${CONFIG_ROOT}/mealie:/app/data"],
    }],
  },
  {
    id: "freshrss", lxc: "freshrss", name: "FreshRSS", category: "Productivity", difficulty: 1, lsio: true,
    desc: "Self-hosted RSS reader. Follow blogs and news without algorithms.",
    docs: "https://freshrss.github.io/FreshRSS/",
    services: [{
      name: "freshrss", image: "lscr.io/linuxserver/freshrss:latest",
      ports: [{ host: 8085, container: 80, label: "Web UI" }],
      volumes: ["${CONFIG_ROOT}/freshrss:/config"],
    }],
  },
  {
    id: "linkding", lxc: "linkding", name: "linkding", category: "Productivity", difficulty: 1,
    desc: "Minimal bookmark manager with tags, search and a browser extension.",
    docs: "https://linkding.link/",
    secrets: ["LINKDING_PASSWORD"],
    note: "Log in as admin with LINKDING_PASSWORD from .env.",
    services: [{
      name: "linkding", image: "sissbruecker/linkding:latest",
      ports: [{ host: 9090, container: 9090, label: "Web UI" }],
      env: { LD_SUPERUSER_NAME: "admin", LD_SUPERUSER_PASSWORD: "${LINKDING_PASSWORD}" },
      volumes: ["${CONFIG_ROOT}/linkding:/etc/linkding/data"],
    }],
  },

  // ---------- AI ----------
  {
    id: "ollama", lxc: "ollama", name: "Ollama", category: "AI", difficulty: 2,
    desc: "Runs open AI models (Llama, Qwen, Mistral...) locally on your server.",
    docs: "https://github.com/ollama/ollama/blob/main/docs/docker.md",
    note: "Runs on the CPU here, which is slow for big models. For an NVIDIA GPU, install the NVIDIA Container Toolkit and follow the Ollama Docker docs.",
    services: [{
      name: "ollama", image: "ollama/ollama:latest",
      ports: [{ host: 11434, container: 11434, label: "API" }],
      volumes: ["${CONFIG_ROOT}/ollama:/root/.ollama"],
    }],
  },
  {
    id: "openwebui", lxc: "openwebui", name: "Open WebUI", category: "AI", difficulty: 2, requires: ["ollama"],
    desc: "ChatGPT-style chat interface for your local Ollama models.",
    docs: "https://docs.openwebui.com/",
    note: "The first account you create becomes the admin. Download models from Settings → Models (try llama3.2 or qwen3 to start).",
    services: [{
      name: "open-webui", image: "ghcr.io/open-webui/open-webui:main",
      ports: [{ host: 3004, container: 8080, label: "Web UI" }],
      env: { OLLAMA_BASE_URL: "http://ollama:11434" },
      volumes: ["${CONFIG_ROOT}/open-webui:/app/backend/data"],
      depends: ["ollama"],
    }],
  },
  {
    id: "n8n", lxc: "n8n", name: "n8n", category: "Dev", difficulty: 2,
    desc: "Visual workflow automation, like a self-hosted Zapier with AI nodes.",
    docs: "https://docs.n8n.io/hosting/installation/docker/",
    note: "n8n runs as user 1000. If your PUID differs, run: sudo chown -R 1000:1000 <config folder>/n8n. N8N_SECURE_COOKIE=false allows logging in over plain HTTP.",
    services: [{
      name: "n8n", image: "docker.n8n.io/n8nio/n8n:latest",
      ports: [{ host: 5678, container: 5678, label: "Web UI" }],
      env: { TZ: "${TZ}", GENERIC_TIMEZONE: "${TZ}", N8N_SECURE_COOKIE: "false" },
      volumes: ["${CONFIG_ROOT}/n8n:/home/node/.n8n"],
    }],
  },
  {
    id: "gitea", lxc: "gitea", name: "Gitea", category: "Dev", difficulty: 2,
    desc: "Lightweight self-hosted Git service, like a mini GitHub.",
    docs: "https://docs.gitea.com/installation/install-with-docker",
    note: "In the install wizard, set the base URL to this server's address and port 3002, and the SSH port to 2222.",
    services: [{
      name: "gitea", image: "gitea/gitea:latest",
      ports: [
        { host: 3002, container: 3000, label: "Web UI" },
        { host: 2222, container: 22, label: "Git over SSH" },
      ],
      env: { USER_UID: "${PUID}", USER_GID: "${PGID}" },
      volumes: ["${CONFIG_ROOT}/gitea:/data", "/etc/localtime:/etc/localtime:ro"],
    }],
  },

  // ---------- Smart home ----------
  {
    id: "homeassistant", lxc: "homeassistant", name: "Home Assistant", category: "Smart Home", difficulty: 2,
    desc: "Control and automate all your smart home devices locally.",
    docs: "https://www.home-assistant.io/installation/linux#docker-compose",
    note: "Uses host networking so device discovery works.",
    services: [{
      name: "homeassistant", image: "ghcr.io/home-assistant/home-assistant:stable",
      hostNetwork: true,
      ports: [{ host: 8123, container: 8123, label: "Web UI" }],
      env: { TZ: "${TZ}" },
      volumes: ["${CONFIG_ROOT}/homeassistant:/config", "/etc/localtime:/etc/localtime:ro", "/run/dbus:/run/dbus:ro"],
    }],
  },
];

const DIFFICULTY = { 1: "Beginner", 2: "Intermediate", 3: "Advanced" };
