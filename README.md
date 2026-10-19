# StarVault

[![CI](https://github.com/The-F00L/starvault/actions/workflows/ci.yml/badge.svg)](https://github.com/The-F00L/starvault/actions/workflows/ci.yml)

A local-first manager for your GitHub stars: search, annotate, organize into collections, audit stale repos, browse anyone's public stars and GitHub Lists, and share collections as links.

**Username only.** StarVault never asks for a password or token. It reads public GitHub data through a small read-only proxy, and your notes, tags and collections stay in your browser.

## Features

| Route | What it does |
|---|---|
| `/`, `/recent`, `/lang/:lang`, `/collections/:id` | Star grid/list with search (⌘K), filters and sorting. Filters live in the URL (`?q=&tag=&lang=&sort=&view=`). |
| `/repo/:owner/:name` | Deep-dive: private note, tags, collections, README, releases, contributors, similar stars |
| `/collections` | Collection manager, unsorted triage, rule-based auto-classify, Awesome-List export |
| `/analytics` | KPIs, language mix, stars per month, repo health, top topics, stale-stars audit |
| `/topics` | Topic and custom-tag index |
| `/u/:username` | **Public profile.** Anyone's public stars and GitHub Lists, read-only. Share this link. |
| `/shared#…` | **Shared collection.** Contains a whole local collection. The data sits in the URL fragment, so it never reaches a server. |

GitHub Lists are imported on every sync and are **read-only** (marked **GH**). Edit them on github.com and sync again. Local collections are fully editable.

## Run locally

```sh
npm install
cp .env.example .env.local   # optional: add a no-permission token (machine account) to enable Lists
npm run dev                   # http://localhost:5173, with /api served by the same proxy code
npm test                      # vitest
npm run build                 # typecheck + static build in dist/
npm run preview:worker        # run the production Worker locally (wrangler dev)
npm run e2e                   # end-to-end sync test against the self-hosted server (needs Google Chrome)
```

Requires Node 22.13 or later.

Without `GITHUB_TOKEN` everything except GitHub Lists works, limited to GitHub's anonymous rate limit (60 requests/hour per IP).

## Deploy to Cloudflare Workers (free, no domain needed)

A single Cloudflare Worker serves the app and the `/api` proxy on a free `starvault.<your-account>.workers.dev` subdomain with HTTPS. You don't need your own domain. Static files are free and unlimited; only `/api` requests run the Worker (100,000 per day on the free plan).

1. **Create a GitHub machine account.** GitHub allows one free machine account per person. The proxy's token belongs to this account, so even if someone abuses the proxy, they only use up the machine account's hourly quota, never yours.
2. **In the machine account, create a fine-grained personal access token** with *Repository access: Public repositories (read-only)*, **no permissions**, and an expiry.
3. **Deploy:**
   ```sh
   npx wrangler login
   npx wrangler secret put GITHUB_TOKEN   # paste the machine account's token
   npm run deploy                         # build + wrangler deploy
   ```
   Your site is at `https://starvault.<your-account>.workers.dev`, and your share link is `…/u/<username>`. To deploy on every push instead, connect the repo under **Workers & Pages → your Worker → Settings → Builds**, with build command `npm run build` and deploy command `npx wrangler deploy`.

### Abuse safeguards

The proxy's token can't write anything or read private data. The remaining risk is someone flooding `/api` to use up its hourly request quota. Three layers prevent that:

| Safeguard | What it does |
|---|---|
| **Machine account** | Abuse can only drain the machine account's quota, not your personal one. |
| **Rate limiting** | The Worker's rate-limiting binding (`wrangler.jsonc`) allows 120 `/api` requests per minute per IP. It counts per Cloudflare location, so treat it as flood protection rather than exact accounting. |
| **Quota reserve** | The proxy reads GitHub's rate-limit headers and stops using the token once fewer than 1,000 requests remain (tracked separately for REST and GraphQL), until GitHub's reset time. Meanwhile the app calls GitHub directly with each visitor's own anonymous allowance, and Lists show when they'll be back. |

Responses are also cached (in memory and in Cloudflare's cache), so repeat visits don't reach GitHub at all.

`public/_headers` ships the security headers for the app (CSP, `Referrer-Policy`, `nosniff`, HSTS, frame blocking). The proxy sets its own headers on API responses.

## Self-host on a homelab (sync across devices)

Run your own instance to keep notes, tags, pins and collections in sync across your devices, and to see your private stars and Lists. The public site keeps working as before, and share links still point at it, because friends can't reach your homelab.

> **Never expose a self-hosted instance to the internet.** It has no login: anyone who can reach it can read your notes. Keep it on your tailnet.

1. Create a fine-grained token at <https://github.com/settings/personal-access-tokens/new>, for your own account:
   - **Account permissions → Starring: Read-only**
   - **Repository access: Public repositories**, or **All repositories** if you want private repos you starred; **Repository permissions → Metadata: Read-only**
   - StarVault never writes to GitHub: star and List edits stay on github.com.
2. Next to `docker-compose.yml`, create `.env`:
   ```
   GITHUB_TOKEN=github_pat_...
   SHARE_BASE_URL=https://starvault.<you>.workers.dev
   ```
3. Start it: `mkdir -p data && sudo chown 1000:1000 data && docker compose up -d`. It pulls the published image `ghcr.io/the-f00l/starvault` and listens on `127.0.0.1:8787` only. To update, run `docker compose pull && docker compose up -d`.
4. Publish it to your tailnet with HTTPS: `tailscale serve --bg 8787`, then open `https://<machine>.<tailnet>.ts.net`.
   - To use another name (MagicDNS short name, Tailscale IP), add it to `ALLOWED_HOSTS` in `.env`. The server ignores unknown host names to block DNS-rebinding attacks.
5. Back up `data/starvault.sqlite` (copy it while the container is stopped, or use `sqlite3 data/starvault.sqlite ".backup backup.sqlite"`).

**Limits of sync.** It's built for one person on a few devices. The newest edit of a record wins as a whole: if two devices edit the same note while apart, the later one replaces the earlier rather than merging the text. If you replace the server's database (a fresh volume, or an older backup), each device notices on its next sync and sends everything it has again.

Settings shows the sync status, any rejected changes, and token problems. Edits made offline sync when the server is reachable again. Without Docker: `npm run build && npm run build:server && GITHUB_TOKEN=... DATA_DIR=./data npm run selfhost`.

## Architecture

- **Frontend:** Vite + React 19 + TypeScript + Tailwind v4. Design tokens are in `src/index.css`.
- **Storage:** IndexedDB via Dexie (`src/lib/db.ts`), with backup and restore as JSON.
- **`src/lib/api.ts`:** fetches public GitHub data through `/api`. If the site is served without the proxy, it falls back to calling `api.github.com` directly, and Lists are unavailable.
- **`server/proxy.ts`:** the read-only proxy, shared by `worker/index.ts` (Cloudflare Worker, configured in `wrangler.jsonc`) and `vite.config.ts` (dev).
- **Collections and sync:** `src/lib/collections.ts` is the only write path for collections. `src/lib/sync.ts` applies a sync and mirrors GitHub Lists.
- **Sharing:** `src/lib/share.ts` encodes and decodes shared-collection links (compressed and validated).
- **Self-hosted server:** `server/main.ts` (entry) and `server/selfhost.ts` serve `dist/`, the proxy with the owner's token (plus `/api/me/*`), and `/api/sync`. `server/store.ts` keeps the synced records in SQLite with last-write-wins; `server/protocol.ts` defines and validates them.
- **Client sync:** in self-hosted mode (detected via `/api/instance` in `src/lib/instance.ts`), every write also lands in a Dexie outbox (`src/lib/outbox.ts`); `src/lib/remote.ts` pushes it and pulls other devices' changes.

## Security model

- **No user credentials anywhere.** The browser never holds a GitHub token. Builds before v2 of the IndexedDB schema could store one; the v2 migration deletes it.
- **The proxy is read-only and allow-listed.**
  - It accepts GET requests to exactly 6 route shapes (8 on a self-hosted server, which adds `/api/me/starred` and `/api/me/lists`), with GitHub usernames and repo names validated.
  - Its token belongs to a dedicated machine account and has no permissions, so a leak exposes only public data under that account's quota.
  - IPs are rate-limited, a quota reserve stops spending the token before it runs out, responses are cached, private Lists are dropped, and the token is never echoed back. See [Abuse safeguards](#abuse-safeguards).
- **All untrusted input is validated** before it's used: repo names (blocking path traversal), usernames, imported backups and share-link payloads.
- **READMEs are sanitized** with `rehype-sanitize`. A CSP blocks inline and third-party scripts.
- **Your data stays local.** On the public site, notes, tags and local collections live only in your browser, until you share a collection link yourself. A self-hosted instance stores them in its SQLite file too; it has no login, so keep it on your tailnet. It binds to `127.0.0.1` by default, refuses to listen on all interfaces without `ALLOW_PUBLIC_BIND=1`, and only answers known host names.

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Report security problems privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
