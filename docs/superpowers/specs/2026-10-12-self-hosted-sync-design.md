# Self-hosted mode with server sync

Date: 2026-10-12
Status: approved design, pending spec review

## Goal

Let the owner run StarVault on their homelab so their catalog (notes, tags, pins, collections) survives across devices, while the public Cloudflare version keeps working exactly as it does today. Share links keep working for friends in both modes.

## Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Where self-hosted runs | Homelab, reachable only over Tailscale | Friends never need to reach it |
| Share links | URL-packed snapshots (existing `/shared#…`) pointing at the **public** site | Friends can't reach the homelab; the public site needs no database |
| GitHub token | Fine-grained, **read-only**: Account → Starring: Read; Repository → Metadata: Read | Probe (2026-10-12) showed fine-grained tokens can't create Lists and can only star repos owned by the token owner, so write features would need a classic `public_repo` token, which can push to every public repo. Not worth it. |
| Writing to GitHub (star/unstar, edit Lists) | Out of scope; the app links to github.com instead | Same reason |
| Sync approach | Local-first: IndexedDB stays the working copy, SQLite on the server is the shared copy, record-level last-write-wins | UI code barely changes, works offline, one frontend build for both modes |
| Access control | Tailscale only, no app login | Single user on a private network |

## Architecture

One frontend build, two deployments:

| | Public (Cloudflare) | Self-hosted (homelab) |
|---|---|---|
| Runtime | Worker + static assets (unchanged) | One Docker container: Node HTTP server + SQLite file on a volume |
| GitHub access | Machine-account proxy (unchanged) | Same `server/proxy.ts` with the owner's read-only token, plus self-hosted-only routes for private stars and private Lists |
| Catalog storage | IndexedDB only | IndexedDB, synced to SQLite |
| Share links | Snapshot links to own origin | Snapshot links to `SHARE_BASE_URL` (the public site) |

### Mode detection

On startup the frontend calls `GET /api/instance`.

- Self-hosted returns `{ mode: "self-hosted", login, avatarUrl, shareBaseUrl, tokenOk, tokenError? }`.
- Anything else (404, the SPA's HTML, a network error) means public mode, with today's behavior.
- In self-hosted mode the username is the token owner's `login` and can't be edited. Settings shows the mode, the sync status, and any token problem.

### Access control

- The server binds to `127.0.0.1` by default (`HOST` env). It refuses to start on `0.0.0.0` or `::` unless `ALLOW_PUBLIC_BIND=1`.
- The README tells you to use `tailscale serve` for HTTPS, and states plainly that the instance must never be exposed publicly, because notes would be readable by anyone.

## What syncs

Only data the user writes:

| kind | key | data | Notes |
|---|---|---|---|
| `meta` | `owner/repo` | `RepoMeta` | Notes, tags, pin, keep |
| `collection` | collection `id` | `Collection` | Local collections only (`githubListId` empty) |
| `item` | `collectionId` + `\u001f` + `owner/repo` | `CollectionItem` | Only for local collections (separator is U+001F, not NUL: `node:sqlite` truncates bound text at a NUL byte) |
| `listOverride` | `gh:<listId>` | `{ icon, rules }` | The user's edits to GitHub-List collections |

Not synced: `repos`, GitHub-List collections and their items (each device re-fetches these from GitHub), `settings`, and demo data (`source: "mock"` repos never reach the outbox; demo meta/collections are wiped by `applySync` before a real sync, as today).

## Server

### `server/store.ts`

SQLite via `node:sqlite` (`DatabaseSync`). This is the only file that touches SQLite, so it can be swapped for `better-sqlite3` if `node:sqlite` changes.

```sql
CREATE TABLE records (
  kind      TEXT NOT NULL,
  key       TEXT NOT NULL,
  data      TEXT,              -- JSON; NULL when deleted
  updatedAt TEXT NOT NULL,     -- ISO timestamp from the writing device
  deleted   INTEGER NOT NULL DEFAULT 0,
  rev       INTEGER NOT NULL,  -- server sequence, unique, increasing
  PRIMARY KEY (kind, key)
);
CREATE INDEX records_rev ON records(rev);
```

- `push(changes)`: for each change, a transaction. If there's no stored row, or `incoming.updatedAt > stored.updatedAt`, store it with `rev = max(rev) + 1`. Otherwise keep the stored row. Returns the winning row for every key, so the client can correct itself.
- `pull(since)`: rows with `rev > since`, ordered by `rev`, at most 1000 per page, plus `{ rev, more }`.
- Ties on `updatedAt` keep the stored row (deterministic).

### HTTP API (self-hosted only)

| Route | Behavior |
|---|---|
| `GET /api/instance` | Mode info. Token checked once at startup and then every 10 minutes via `GET /user`. |
| `GET /api/sync?since=<rev>` | `{ changes, rev, more }` |
| `POST /api/sync` | Body `{ changes: Change[] }`, at most 500 changes and 1 MB. Returns `{ results: Change[] }` (the stored winners). |
| `/api/users/…`, `/api/repos/…` | Existing proxy routes (`parseRoute`), unchanged |
| `GET /api/me/starred?page=`, `GET /api/me/lists` | Self-hosted only: the token owner's stars via `GET /user/starred` (private included) and their Lists without the private-List filter (`server/proxy.ts:172`). The client uses these instead of `/api/users/<login>/…` when the instance is self-hosted. |
| everything else | Static files from `dist/`, SPA fallback to `index.html`, security headers matching `public/_headers` |

Validation: `kind` must be one of the four kinds above. `meta` and `item` keys must pass `isValidRepoName` (and a valid collection id for `item`). `updatedAt` must parse as a date and be at most 5 minutes in the future. `note` is capped at 20 KB. Invalid input returns 400 with an error code; a batch is rejected as a whole.

The self-hosted-only proxy routes are enabled by a flag on `ProxyEnv` that the Worker never sets.

### Deployment

- `Dockerfile`: multi-stage. Build with `npm run build`, then run `node server/selfhost.js` (compiled) on a pinned `node:24-slim`.
- `docker-compose.yml`: `env_file: .env` (`GITHUB_TOKEN`, `SHARE_BASE_URL`), volume `./data:/data`, `ports: ["127.0.0.1:8787:8787"]`.
- README section "Self-host on a homelab": the token settings above, `docker compose up -d`, `tailscale serve 8787`, the never-expose warning, and a backup tip (copy `data/starvault.sqlite`).

## Client

### Dexie v3

New tables:

- `outbox`: `++seq, kind, key`, holding `{ seq, kind, key, data, updatedAt, deleted }`. A newer entry for the same `kind+key` replaces the older one.
- `syncState`: a single row `{ key: "main", rev, lastPullAt, lastPushAt, lastError, firstSyncDone }`.

### Write path

The existing write functions (`updateMeta`, `createCollection`, `updateCollection`, `deleteCollection`, `assignMany`, the list-override path in `updateCollection` for linked collections) add outbox entries **in the same Dexie transaction** as the local write. They do this only when the instance is self-hosted (a module-level flag set by `instance.ts`). On the public site the outbox stays empty.

`applySync`, `applyListsSync`, `removeRepo` and the demo seed don't write to the outbox (they handle GitHub-derived data or demo data). One exception: when a local collection item is removed because its repo was unstarred, that delete **is** queued.

### `src/lib/remote.ts` (sync engine)

- `flush()`: send outbox entries in batches of 500 in `seq` order, then delete each acknowledged entry, but only if no newer entry for the same key arrived meanwhile. Apply the returned winners locally (a loss means the server had a newer version).
- `pull()`: page through `GET /api/sync?since=rev` and apply each change directly to the Dexie tables (no outbox). Skip any change whose key has a pending outbox entry; the next flush settles it. Save the new `rev`.
- **Triggers:** flush 1 s after a write (debounced), pull on start, on `visibilitychange` to visible, and every 5 minutes. A sync never runs concurrently with another.
- **First connection** (`firstSyncDone` false): queue every local `meta`, local collection, item and list override into the outbox, flush, pull, then set `firstSyncDone`. Last-write-wins merges the two sides.
- **Applying a `listOverride`:** patch `icon`/`rules` on the `gh:` collection if it exists. Otherwise keep it in a small `pendingOverrides` map in `syncState`, applied after the next `applyListsSync`.

### UI

- Settings in self-hosted mode: the username is shown read-only with a "self-hosted" badge, plus sync status (last synced, pending count, last error, a "Sync now" button) and token status.
- Share dialogs use `shareBaseUrl` when it's set.
- GitHub-List collections and repo pages link to github.com for star and List editing (as today).

## Errors

| Situation | Behavior |
|---|---|
| Server unreachable | Local edits continue. The outbox grows and the status shows "offline, N pending". Retries with backoff (5 s → 5 min). |
| 400 from push | Log it, move the offending entries aside (`outbox` entry flagged `rejected`), show the count in Settings. Don't retry forever. |
| Token invalid or expired | `/api/instance` reports `tokenOk: false`. Settings explains it, GitHub fetches fall back to the anonymous direct path, and sync of user data still works. |
| SQLite errors | 500 with a code. The client retries like an unreachable server. |

## Testing

- **`server/store.test.ts`** (in-memory SQLite): insert; newer wins; older loses; tie keeps stored; tombstones; `pull(since)` order and paging; `rev` increases across transactions.
- **`server/selfhost.test.ts`**: `/api/instance` shape; `/api/sync` validation (bad kind, bad key, oversized note, future timestamp, batch limit); the bind refusal without `ALLOW_PUBLIC_BIND`; SPA fallback and headers; self-hosted routes absent when the flag is off (and in the Worker).
- **`src/lib/remote.test.ts`** (fake-indexeddb, two Dexie instances, the store behind an in-process fetch):
  - Two devices converge.
  - Offline edits flush on reconnect.
  - Pulled changes don't create outbox entries.
  - First connection merges without losing data on either side.
  - Delete propagation.
  - A pending local edit isn't overwritten by a pull.
  - List overrides are applied after `applyListsSync`.
  - A public instance never writes the outbox.
- **End to end** (Playwright, two clean Chrome profiles, local Node server): create a collection and a note in A, then see both in B after focus; delete in B, then see it gone in A.

## Out of scope

Writing to GitHub, multiple users, an app login, a database on the public site, live share links served from the homelab, and field-level merging of notes.
