# Homelab Stack Builder

A static website for homelabbers that combines two tools:

1. **Find apps**: pick what you want to do ("Replace Google Photos", "Block ads"…), your Docker
   experience level and where you'll run it, and get app suggestions with difficulty ratings.
2. **Build stack**: browse 160 apps (with a Top 10 for newcomers) and get a ready-to-run
   `docker-compose.yml`, a `.env` with generated passwords, and a `SETUP.md` guide for your platform.
   It detects and auto-fixes port conflicts, including ports your NAS already uses.

No build step and no dependencies. Open `index.html` in a browser, or host the folder anywhere
static (e.g. GitHub Pages).

## Deploy targets

Linux server/VM, Proxmox (Docker in a VM, Docker in an LXC, or one LXC per app with no Docker),
Synology, Unraid and Docker Desktop. The target changes the default folders/IDs, warnings and the
setup guide.

In **one LXC per app** mode, each app is installed with a
[community helper script](https://community-scripts.github.io/ProxmoxVE/) when one exists. Otherwise
Proxmox VE 9.1+ pulls the app's image and runs it directly as an LXC (`pvesh … oci-registry-pull` +
`pct create`), with its folders as mount points and its settings as `lxc.environment.runtime` lines.
Apps that can't work that way (multi-container apps, apps that need Docker itself) stay in
`docker-compose.yml` for one Docker LXC, and the guide suggests a no-Docker alternative where there is one.

## Files

| File | What it is |
|------|------------|
| `index.html`  | Page layout |
| `style.css`   | Styling (dark/light follows your system) |
| `apps.js`     | Core app catalog, with the full field reference at the top |
| `apps-more.js`| More apps, mostly in the compact single-container form |
| `goals.js`    | Picker goals, the Top 10 list and category order |
| `deploy.js`   | Deploy targets and the SETUP.md generator |
| `app.js`      | Picker/catalog UI, compose/.env generation, port conflict detection |

## Adding an app

Copy an entry in `apps-more.js` (the compact form is enough for most single-container apps).
Pick a host port no other app uses. Add `lxc: "<slug>"` if the app has a Proxmox helper script,
and reference its `id` in a goal's `picks` in `goals.js` if it should show up in the picker.

## Tests

Needs Node 18+ and the Docker CLI.

```sh
npm test                           # catalog, ports, every deploy target, docker compose config
npm run test:full                  # also checks every image exists on its registry
node tests/smoke.js jellyfin n8n   # actually starts apps and checks their web UIs answer
```

GitHub Actions runs `test:full` on every push and weekly, which catches images that get renamed and
Proxmox helper scripts that get removed.

## Sharing

"Share link" copies a URL like `index.html#stack=jellyfin,sonarr,radarr` that opens the same stack.
Passwords are never included.

## Using the output

Put `docker-compose.yml` and `.env` in the same folder on your server, then run:

```sh
docker compose up -d
```
