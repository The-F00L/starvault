/**
 * StarVault read-only GitHub proxy.
 *
 * Runs on Cloudflare Pages Functions in production and as Vite middleware in development.
 * It exists because (a) GitHub Lists are only reachable via GraphQL, which requires a token,
 * and (b) anonymous REST calls are limited to 60/hour per visitor IP.
 *
 * Hardening: fixed allow-list of routes, strict input validation, GET only, a server-held
 * token with NO permissions (public data only), response caching, and a per-IP rate limit.
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
  allow?: (ip: string) => boolean;
}

type Route =
  | { kind: "user"; login: string }
  | { kind: "starred"; login: string; page: number }
  | { kind: "lists"; login: string }
  | { kind: "repo"; owner: string; name: string; resource: "readme" | "releases" | "contributors" };

const TTL: Record<Route["kind"], number> = { user: 3600, starred: 600, lists: 600, repo: 3600 };

export function parseRoute(url: URL): Route | null {
  const parts = url.pathname.replace(/^\/api\//, "").split("/").filter(Boolean);
  if (parts[0] === "users" && parts[1] && LOGIN.test(parts[1])) {
    const login = parts[1];
    if (parts.length === 2) return { kind: "user", login };
    if (parts.length === 3 && parts[2] === "lists") return { kind: "lists", login };
    if (parts.length === 3 && parts[2] === "starred") {
      const page = Number(url.searchParams.get("page") ?? "1");
      if (!Number.isInteger(page) || page < 1 || page > MAX_STAR_PAGE) return null;
      return { kind: "starred", login, page };
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
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", ...extra },
  });

class Upstream extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function github(env: ProxyEnv, path: string, accept = "application/vnd.github+json") {
  const res = await env.fetch(`${GITHUB}${path}`, {
    headers: {
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "StarVault-proxy",
      ...(env.token ? { Authorization: `Bearer ${env.token}` } : {}),
    },
  });
  if (!res.ok) {
    if (res.status === 404) throw new Upstream("Not found on GitHub", 404);
    if (res.status === 403 || res.status === 429) throw new Upstream("GitHub rate limit reached — try again in a few minutes", 503);
    throw new Upstream(`GitHub returned ${res.status}`, 502);
  }
  return res;
}

async function graphql<T>(env: ProxyEnv, query: string, variables: Record<string, unknown>): Promise<T> {
  if (!env.token) throw new Upstream("GitHub Lists are unavailable: the proxy has no GitHub token configured", 503);
  const res = await env.fetch(`${GITHUB}/graphql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.token}`, "Content-Type": "application/json", "User-Agent": "StarVault-proxy" },
    body: JSON.stringify({ query, variables }),
  });
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

async function lists(env: ProxyEnv, login: string) {
  const data = await graphql<{ user: { lists: { nodes: (Record<string, unknown> & { id: string; items: ItemsPage })[] } } | null }>(
    env,
    `query($login: String!, $itemsAfter: String) { user(login: $login) { lists(first: 50) { nodes {
      id name description isPrivate slug createdAt updatedAt ${ITEMS}
    } } } }`,
    { login, itemsAfter: null },
  );
  if (!data.user) throw new Upstream("Not found on GitHub", 404);
  const out = [];
  for (const { items, ...list } of data.user.lists.nodes) {
    // Only public lists are ever returned; the proxy token has no access to anyone's private data.
    if (list.isPrivate) continue;
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
  const route = parseRoute(url);
  if (!route) return json({ error: "Not found" }, 404);

  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  if (env.allow && !env.allow(ip)) return json({ error: "Too many requests" }, 429, { "Retry-After": "60" });

  // Normalise the cache key so query-string junk can't bust the cache.
  const cacheKey = new Request(`${url.origin}${url.pathname}${route.kind === "starred" ? `?page=${route.page}` : ""}`);
  const cached = await env.cache?.match(cacheKey);
  if (cached) return cached;

  try {
    const body = await resolve(env, route);
    const res = json(body, 200, { "Cache-Control": `public, max-age=${TTL[route.kind]}` });
    await env.cache?.put(cacheKey, res.clone());
    return res;
  } catch (e) {
    if (e instanceof Upstream) return json({ error: e.message }, e.status);
    return json({ error: "Proxy error" }, 500);
  }
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
