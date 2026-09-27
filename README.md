# StarVault

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
cp .env.example .env.local   # optional: add a no-permission token to enable Lists
npm run dev                   # http://localhost:5173, with /api served by the same proxy code
npm test                      # vitest
npm run build                 # typecheck + static build in dist/
```

Without `GITHUB_TOKEN` everything except GitHub Lists works, limited to GitHub's anonymous rate limit (60 requests/hour per IP).

## Deploy to Cloudflare Pages (free, no domain needed)

Cloudflare Pages hosts the site for free on a `<project>.pages.dev` subdomain with HTTPS, so you don't need your own domain.

1. Push this repo to GitHub.
2. In Cloudflare, go to **Workers & Pages → Create → Pages → Connect to Git** and pick the repo.
   - Build command: `npm run build`
   - Output directory: `dist`

   `functions/` is picked up automatically and serves `/api/*`.
3. Create a **fine-grained personal access token** on GitHub with *Repository access: Public repositories (read-only)*, **no permissions**, and an expiry. Add it under **Settings → Variables and Secrets** as the encrypted secret `GITHUB_TOKEN`, or run `npx wrangler pages secret put GITHUB_TOKEN`.
4. Deploy. The site is live at `https://<project>.pages.dev`, and your shareable profile link is `https://<project>.pages.dev/u/<username>`.

`public/_headers` ships the security headers (CSP, `Referrer-Policy`, `nosniff`, HSTS, frame blocking).

## Architecture

- **Frontend:** Vite + React 19 + TypeScript + Tailwind v4. Design tokens are in `src/index.css`.
- **Storage:** IndexedDB via Dexie (`src/lib/db.ts`), with backup and restore as JSON.
- **`src/lib/api.ts`:** fetches public GitHub data through `/api`. If the site is served without the proxy, it falls back to calling `api.github.com` directly, and Lists are unavailable.
- **`server/proxy.ts`:** the read-only proxy, shared by `functions/api/[[path]].ts` (Cloudflare) and `vite.config.ts` (dev).
- **Collections and sync:** `src/lib/collections.ts` is the only write path for collections. `src/lib/sync.ts` applies a sync and mirrors GitHub Lists.
- **Sharing:** `src/lib/share.ts` encodes and decodes shared-collection links (compressed and validated).

## Security model

- **No user credentials anywhere.** The browser never holds a GitHub token. Builds before v2 of the IndexedDB schema could store one; the v2 migration deletes it.
- **The proxy is read-only and allow-listed.**
  - It accepts GET requests to exactly 6 route shapes, with GitHub usernames and repo names validated.
  - Its token has no permissions, so a leak exposes only public data under your rate limit.
  - Responses are cached, IPs are rate-limited, private Lists are dropped, and the token is never echoed back.
- **All untrusted input is validated** before it's used: repo names (blocking path traversal), usernames, imported backups and share-link payloads.
- **READMEs are sanitized** with `rehype-sanitize`. A CSP blocks inline and third-party scripts.
- **Your data stays local.** Notes, tags and local collections live only in your browser, until you share a collection link yourself.
