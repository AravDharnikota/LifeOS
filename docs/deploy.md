# Deploying AravOS

One process serves everything: the REST API, the MCP endpoint (`/mcp`), uploaded photos, and the
built web app. State lives in one SQLite file plus an `uploads` folder under `ARAVOS_DATA_DIR`.

## Environment variables
Copy `.env.example` to `.env` (or set them in your host's secrets):

| Variable | Required | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | for AI features | Food photo analysis, body progress comparisons, the in-app assistant, duration estimates |
| `ANTHROPIC_MODEL` | no | Default `claude-sonnet-5-5`. `claude-opus-5-5` is stronger for planning, at a higher cost |
| `ANTHROPIC_VISION_MODEL` | no | Model for photo analysis (defaults to `ANTHROPIC_MODEL`) |
| `ARAVOS_TOKEN` | yes once exposed to the internet | Bearer token the apps and every MCP client must send. Generate with `openssl rand -hex 32` |
| `ARAVOS_PUBLIC_URL` | yes | Public base URL (used for Google OAuth redirect and MCP instructions) |
| `ARAVOS_TIMEZONE` | yes | IANA timezone of the user, e.g. `America/Los_Angeles` |
| `ARAVOS_DATA_DIR` | no | Where `aravos.db` and `uploads/` live (default `./data`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for Google sync | See `docs/google-sync.md` |
| `PORT` | no | Default 8787 |

## Option A: Fly.io (recommended, about $3 a month)
```bash
brew install flyctl && fly auth login
fly launch --copy-config --no-deploy        # uses fly.toml; pick an app name and region
fly volumes create aravos_data --size 1
fly secrets set ANTHROPIC_API_KEY=sk-ant-... ARAVOS_TOKEN=$(openssl rand -hex 32)
fly deploy
```
Set `ARAVOS_PUBLIC_URL` in `fly.toml` to your app's URL. The volume keeps the database between deploys.

## Option B: Docker anywhere (Railway, Render, a VPS, a home server)
```bash
docker build -t aravos .
docker run -d --name aravos -p 8787:8787 -v aravos_data:/data \
  -e ANTHROPIC_API_KEY=sk-ant-... -e ARAVOS_TOKEN=change-me \
  -e ARAVOS_PUBLIC_URL=https://aravos.example.com -e ARAVOS_TIMEZONE=America/Los_Angeles aravos
```
Put it behind HTTPS (Caddy, Cloudflare Tunnel, Tailscale Serve). Tailscale is the simplest private
option: the phone and every agent on your tailnet can reach it, nobody else can.

## Option C: a Mac mini or laptop at home
```bash
pnpm install && pnpm build
ARAVOS_DATA_DIR=~/aravos-data ARAVOS_TOKEN=... ANTHROPIC_API_KEY=... pnpm start
```
Expose with `tailscale serve --bg 8787` (gives you an HTTPS URL on your tailnet) and use that URL
in the iPhone app and in MCP clients.

## Backups
Everything is in `ARAVOS_DATA_DIR`: copy `aravos.db` (with its `-wal` file, or run `sqlite3 aravos.db ".backup out.db"`)
and the `uploads/` folder. Settings, Export Data also produces a JSON snapshot.

## Updating
`git pull && pnpm install && pnpm build && pnpm start` (or `fly deploy`). Database migrations run
automatically on startup.
