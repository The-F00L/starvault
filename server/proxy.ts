/**
 * StarVault read-only GitHub proxy.
 *
 * Runs in the Cloudflare Worker (worker/index.ts) in production and as Vite middleware in development.
 * It exists because (a) GitHub Lists are only reachable via GraphQL, which requires a token,
 * and (b) anonymous REST calls are limited to 60/hour per visitor IP.
 *
 * Hardening: fixed allow-list of routes, strict input validation, GET only, a server-held
 * token with NO permissions (public data only), response caching, a per-IP rate limit, and a
 * quota reserve that stops spending the token before its hourly budget runs out. The /api/me/*
 * routes (the token owner's own stars and Lists, private ones included) exist only on a
 * self-hosted server (`selfHosted`); the public Worker never enables them.
 */

const GITHUB = "https://api.github.com";
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;
const MAX_STAR_PAGE = 100; // 10,000 stars
const MAX_LIST_ITEM_PAGES = 5; // per list, beyond the first 100 items

export interface ProxyEnv {
  token: string;
  fetch: typeof fetch;
  /** Optional shared cache (Cloudflare `caches.default`). */
  cache?: { match(req: Request): Promise<Response | undefined>; put(req: Request, res: Response): Promise<void> };
  /** Returns false when the caller exceeded the rate limit. */
  allow?: (ip: string) => boolean | Promise<boolean>;
  /** Tracks GitHub's remaining quota so the token is never drained to zero. */
  quota?: QuotaGuard;
  /** Self-hosted only: enables /api/me/* (the token owner's own stars and Lists, private ones included). The Worker never sets it. */
  selfHosted?: boolean;
}

export type QuotaResource = "core" | "graphql";

/**
 * Remembers GitHub's `x-ratelimit-remaining` per resource and refuses to spend the token once
 * it falls to the reserve, until GitHub's reset time. State is per isolate (best effort); the
 * rate limiter keeps any single client from getting close in the first place.
 */
export class QuotaGuard {
  private state = new Map<QuotaResource, { remaining: number; resetAt: number }>();

  constructor(
    readonly reserve = 1000,
    private now = () => Date.now(),
  ) {}

  record(res: Response) {
    const remaining = Number(res.headers.get("x-ratelimit-remaining"));
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const resource = res.headers.get("x-ratelimit-resource") === "graphql" ? "graphql" : "core";
    if (Number.isFinite(remaining) && Number.isFinite(reset) && res.headers.has("x-ratelimit-remaining")) {
      this.state.set(resource, { remaining, resetAt: reset * 1000 });
    }
  }

  /** Epoch ms when the token may be used again, or null if it can be used now. */
  blockedUntil(resource: QuotaResource): number | null {
    const s = this.state.get(resource);
    if (!s || this.now() >= s.resetAt || s.remaining > this.reserve) return null;
    return s.resetAt;
  }
}

type Route =
  | { kind: "user"; login: string }
  | { kind: "starred"; login: string; page: number }
  | { kind: "lists"; login: string }
  | { kind: "meStarred"; page: number }
  | { kind: "meLists" }
  | { kind: "repo"; owner: string; name: string; resource: "readme" | "releases" | "contributors" };

// The owner's own data is cached briefly so a fresh star shows up on the next sync.
const TTL: Record<Route["kind"], number> = { user: 3600, starred: 600, lists: 600, meStarred: 60, meLists: 60, repo: 3600 };

function starPage(url: URL): number | null {
  const page = Number(url.searchParams.get("page") ?? "1");
  return Number.isInteger(page) && page >= 1 && page <= MAX_STAR_PAGE ? page : null;
}

export function parseRoute(url: URL, selfHosted = false): Route | null {
  const parts = url.pathname.replace(/^\/api\//, "").split("/").filter(Boolean);
  if (parts[0] === "users" && parts[1] && LOGIN.test(parts[1])) {
    const login = parts[1];
    if (parts.length === 2) return { kind: "user", login };
    if (parts.length === 3 && parts[2] === "lists") return { kind: "lists", login };
    if (parts.length === 3 && parts[2] === "starred") {
      const page = starPage(url);
      return page ? { kind: "starred", login, page } : null;
    }
  }
  if (selfHosted && parts[0] === "me" && parts.length === 2) {
    if (parts[1] === "lists") return { kind: "meLists" };
    if (parts[1] === "starred") {
      const page = starPage(url);
      return page ? { kind: "meStarred", page } : null;
    }
  }
  if (parts[0] === "repos" && parts.length === 4 && SEGMENT.test(parts[1]) && SEGMENT.test(parts[2])) {
    const resource = parts[3];
    if (resource === "readme" || resource === "releases" || resource === "contributors") {
      return { kind: "repo", owner: parts[1], name: parts[2], resource };
    }
  }
  return null;
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...extra },
  });

class Upstream extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Thrown instead of calling GitHub when the token's quota is down to the reserve. */
function checkQuota(env: ProxyEnv, resource: QuotaResource) {
  const until = env.quota?.blockedUntil(resource);
  if (until) {
    throw new Upstream(`StarVault's shared GitHub quota is paused until ${new Date(until).toISOString().slice(11, 16)} UTC`, 503, "QUOTA_RESERVE");
  }
}

async function github(env: ProxyEnv, path: string, accept = "application/vnd.github+json") {
  checkQuota(env, "core");
  const res = await env.fetch(`${GITHUB}${path}`, {
    headers: {
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "StarVault-proxy",
      ...(env.token ? { Authorization: `Bearer ${env.token}` } : {}),
    },
  });
  env.quota?.record(res);
  if (!res.ok) {
    if (res.status === 404) throw new Upstream("Not found on GitHub", 404);
    if (res.status === 403 || res.status === 429) throw new Upstream("GitHub rate limit reached — try again in a few minutes", 503);
    throw new Upstream(`GitHub returned ${res.status}`, 502);
  }
  return res;
}

async function graphql<T>(env: ProxyEnv, query: string, variables: Record<string, unknown>): Promise<T> {
  if (!env.token) throw new Upstream("GitHub Lists are unavailable: the proxy has no GitHub token configured", 503);
  checkQuota(env, "graphql");
  const res = await env.fetch(`${GITHUB}/graphql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.token}`, "Content-Type": "application/json", "User-Agent": "StarVault-proxy" },
    body: JSON.stringify({ query, variables }),
  });
  env.quota?.record(res);
  if (res.status === 403 || res.status === 429) throw new Upstream("GitHub rate limit reached — try again in a few minutes", 503);
  if (!res.ok) throw new Upstream(`GitHub returned ${res.status}`, 502);
  const body = (await res.json()) as { data?: T; errors?: { type?: string; message: string }[] };
  if (body.errors?.length) {
    if (body.errors.some((e) => e.type === "NOT_FOUND")) throw new Upstream("Not found on GitHub", 404);
    throw new Upstream("GitHub GraphQL error", 502);
  }
  return body.data as T;
}

const ITEMS = `items(first: 100, after: $itemsAfter) { totalCount pageInfo { hasNextPage endCursor } nodes { ... on Repository { nameWithOwner } } }`;

interface ItemsPage {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: ({ nameWithOwner?: string } | null)[];
}

const LIST_FIELDS = `lists(first: 50) { nodes { id name description isPrivate slug createdAt updatedAt ${ITEMS} } }`;

type ListNode = Record<string, unknown> & { id: string; isPrivate?: boolean; items: ItemsPage };

/** A user's star Lists; `login: null` means the token owner's own (self-hosted /api/me/lists). */
async function lists(env: ProxyEnv, login: string | null) {
  const nodes = login
    ? (await graphql<{ user: { lists: { nodes: ListNode[] } } | null }>(
        env,
        `query($login: String!, $itemsAfter: String) { user(login: $login) { ${LIST_FIELDS} } }`,
        { login, itemsAfter: null },
      )).user?.lists.nodes
    : (await graphql<{ viewer: { lists: { nodes: ListNode[] } } }>(env, `query($itemsAfter: String) { viewer { ${LIST_FIELDS} } }`, { itemsAfter: null })).viewer
        .lists.nodes;
  if (!nodes) throw new Upstream("Not found on GitHub", 404);
  const out = [];
  for (const { items, ...list } of nodes) {
    // Public routes only ever return public lists. Only the owner's own token, on their own server, sees private ones.
    if (list.isPrivate && login) continue;
    const repos = items.nodes.flatMap((n) => (n?.nameWithOwner ? [n.nameWithOwner] : []));
    let cursor = items.pageInfo.hasNextPage ? items.pageInfo.endCursor : null;
    for (let i = 0; cursor && i < MAX_LIST_ITEM_PAGES; i++) {
      const more = await graphql<{ node: { items: ItemsPage } }>(env, `query($id: ID!, $itemsAfter: String) { node(id: $id) { ... on UserList { ${ITEMS} } } }`, {
        id: list.id,
        itemsAfter: cursor,
      });
      repos.push(...more.node.items.nodes.flatMap((n) => (n?.nameWithOwner ? [n.nameWithOwner] : [])));
      cursor = more.node.items.pageInfo.hasNextPage ? more.node.items.pageInfo.endCursor : null;
    }
    out.push({ ...list, repos });
  }
  return out;
}

async function resolve(env: ProxyEnv, route: Route): Promise<unknown> {
  switch (route.kind) {
    case "user": {
      const u = await (await github(env, `/users/${route.login}`)).json();
      return { login: u.login, name: u.name, avatarUrl: u.avatar_url, bio: u.bio, htmlUrl: u.html_url };
    }
    case "starred": {
      const res = await github(env, `/users/${route.login}/starred?per_page=100&page=${route.page}`, "application/vnd.github.star+json");
      return { items: await res.json(), hasNext: /rel="next"/.test(res.headers.get("Link") ?? "") };
    }
    case "lists":
      return lists(env, route.login);
    case "meStarred": {
      const res = await github(env, `/user/starred?per_page=100&page=${route.page}`, "application/vnd.github.star+json");
      return { items: await res.json(), hasNext: /rel="next"/.test(res.headers.get("Link") ?? "") };
    }
    case "meLists":
      return lists(env, null);
    case "repo": {
      const base = `/repos/${route.owner}/${route.name}`;
      if (route.resource === "readme") {
        try {
          return { markdown: await (await github(env, `${base}/readme`, "application/vnd.github.raw+json")).text() };
        } catch (e) {
          if (e instanceof Upstream && e.status === 404) return { markdown: null };
          throw e;
        }
      }
      if (route.resource === "releases") return (await github(env, `${base}/releases?per_page=10`)).json();
      const res = await github(env, `${base}/contributors?per_page=24`);
      return res.status === 204 ? [] : res.json();
    }
  }
}

export async function handleProxy(request: Request, env: ProxyEnv): Promise<Response> {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
  const url = new URL(request.url);
  const route = parseRoute(url, env.selfHosted);
  if (!route) return json({ error: "Not found" }, 404);

  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  if (env.allow && !(await env.allow(ip))) return json({ error: "Too many requests" }, 429, { "Retry-After": "60" });

  // Normalise the cache key so query-string junk can't bust the cache.
  const paged = route.kind === "starred" || route.kind === "meStarred";
  const cacheKey = new Request(`${url.origin}${url.pathname}${paged ? `?page=${route.page}` : ""}`);
  const cached = await env.cache?.match(cacheKey);
  if (cached) return cached;

  try {
    const body = await resolve(env, route);
    // The owner's own routes carry private data: only the browser may cache them.
    const scope = route.kind === "meStarred" || route.kind === "meLists" ? "private" : "public";
    const res = json(body, 200, { "Cache-Control": `${scope}, max-age=${TTL[route.kind]}` });
    await env.cache?.put(cacheKey, res.clone());
    return res;
  } catch (e) {
    if (e instanceof Upstream) return json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, e.status);
    return json({ error: "Proxy error" }, 500);
  }
}

type Cache = NonNullable<ProxyEnv["cache"]>;

/** Small per-isolate LRU honouring each response's max-age. */
export class MemoryCache implements Cache {
  private entries = new Map<string, { expires: number; body: string; status: number; headers: [string, string][] }>();

  constructor(
    private max = 300,
    private now = () => Date.now(),
  ) {}

  async match(req: Request) {
    const e = this.entries.get(req.url);
    if (!e) return undefined;
    this.entries.delete(req.url);
    if (e.expires < this.now()) return undefined;
    this.entries.set(req.url, e); // refresh LRU position
    return new Response(e.body, { status: e.status, headers: e.headers });
  }

  async put(req: Request, res: Response) {
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("Cache-Control") ?? "")?.[1] ?? 0);
    if (!maxAge) return;
    this.entries.set(req.url, { expires: this.now() + maxAge * 1000, body: await res.text(), status: res.status, headers: [...res.headers] });
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
  }
}

/** Check caches in order; write to all of them. */
export function tieredCache(...caches: Cache[]): Cache {
  return {
    async match(req) {
      for (const c of caches) {
        const hit = await c.match(req);
        if (hit) return hit;
      }
      return undefined;
    },
    async put(req, res) {
      await Promise.all(caches.map((c) => c.put(req, res.clone())));
    },
  };
}

/** Best-effort fixed-window limiter (per isolate). Pair with a Cloudflare rate-limiting rule for real enforcement. */
export function createRateLimiter(limit = 120, windowMs = 60_000) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (ip: string) => {
    const now = Date.now();
    const entry = hits.get(ip);
    if (!entry || entry.reset < now) {
      if (hits.size > 10_000) hits.clear();
      hits.set(ip, { count: 1, reset: now + windowMs });
      return true;
    }
    return ++entry.count <= limit;
  };
}
