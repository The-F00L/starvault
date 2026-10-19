/**
 * StarVault self-hosted server: the built app, the GitHub proxy with the owner's read-only token,
 * and catalog sync backed by SQLite. Meant for a private network (Tailscale) only: anyone who
 * can reach it can read the notes.
 */
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { MAX_BODY_BYTES, ProtocolError, validateChanges } from "./protocol";
import { handleProxy, MemoryCache, QuotaGuard } from "./proxy";
import type { Store } from "./store";

export interface SelfHostConfig {
  host: string;
  port: number;
  dataDir: string;
  distDir: string;
  /** Owner's fine-grained, read-only PAT (Starring: Read, Metadata: Read). */
  token: string;
  /** Public StarVault origin that share links point to (friends can't reach the homelab). */
  shareBaseUrl: string | null;
  allowPublicBind: boolean;
  /** Extra host names to answer (MagicDNS short name, Tailscale IP), without port. */
  allowedHosts: string[];
}

export function loadConfig(env: Record<string, string | undefined>): SelfHostConfig {
  const share = env.SHARE_BASE_URL?.trim();
  if (share && !/^https?:\/\/[^/\s]+/.test(share)) throw new Error(`SHARE_BASE_URL must be an http(s) URL, got "${share}"`);
  return {
    host: env.HOST ?? "127.0.0.1",
    port: Number(env.PORT || 8787),
    dataDir: env.DATA_DIR || "/data",
    distDir: env.DIST_DIR || "dist",
    token: env.GITHUB_TOKEN?.trim() ?? "",
    shareBaseUrl: share ? share.replace(/\/+$/, "") : null,
    allowPublicBind: env.ALLOW_PUBLIC_BIND === "1",
    allowedHosts: (env.ALLOWED_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  };
}

const ALL_INTERFACES = new Set(["", "0.0.0.0", "::", "[::]"]);

/** Listening on every interface must be a deliberate choice: notes are readable by anyone who can connect. */
export function assertSafeBind(config: SelfHostConfig) {
  if (ALL_INTERFACES.has(config.host) && !config.allowPublicBind) {
    throw new Error(
      `Refusing to listen on all interfaces (HOST=${config.host || '""'}). Keep HOST=127.0.0.1 and use \`tailscale serve\`, ` +
        "or set ALLOW_PUBLIC_BIND=1 if something else restricts access (as docker-compose.yml does by publishing on 127.0.0.1 only).",
    );
  }
}

export interface TokenStatus {
  ok: boolean;
  login: string | null;
  avatarUrl: string | null;
  error?: string;
  /** The check failed for a reason unrelated to the token (network, GitHub outage, odd reply); it may pass next time. */
  transient?: true;
}

/** Ask GitHub who owns the token. Never throws. */
export async function checkToken(token: string, fetchFn: typeof fetch): Promise<TokenStatus> {
  const fail = (error: string): TokenStatus => ({ ok: false, login: null, avatarUrl: null, error });
  const outage = (error: string): TokenStatus => ({ ...fail(error), transient: true });
  if (!token) return fail("GITHUB_TOKEN is not set");
  let res: Response;
  try {
    res = await fetchFn("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "StarVault-selfhost" },
    });
  } catch {
    return outage("Couldn't reach GitHub to check the token");
  }
  if (res.status === 401) return fail("GitHub rejected the token: it's expired, revoked or mistyped");
  // GitHub answers a rate limit with 403 (or 429): the token is fine, try again later.
  if (res.status === 429 || (res.status === 403 && (await isRateLimited(res)))) return outage("GitHub's rate limit was hit while checking the token");
  if (res.status === 403) return fail("GitHub rejected the token (403): it lacks permission or is blocked");
  if (!res.ok) return outage(`GitHub returned ${res.status} while checking the token`);
  let u: { login?: unknown; avatar_url?: unknown } | null;
  try {
    u = (await res.json()) as typeof u;
  } catch {
    return outage("GitHub's reply to the token check wasn't JSON (a captive portal or proxy in the way?)");
  }
  if (typeof u?.login !== "string" || !u.login) return outage("GitHub's reply to the token check had no login");
  return { ok: true, login: u.login, avatarUrl: typeof u.avatar_url === "string" ? u.avatar_url : null };
}

async function isRateLimited(res: Response) {
  if (res.headers.get("x-ratelimit-remaining") === "0") return true;
  const body = (await res.clone().json().catch(() => null)) as { message?: unknown } | null;
  return typeof body?.message === "string" && /rate limit/i.test(body.message);
}

/**
 * The status to serve after a check. A transient failure keeps the last good status, so clients don't drop to
 * public-only data during a GitHub hiccup. Otherwise take the new one, keeping the last known owner so the
 * username doesn't flicker away.
 */
export function nextTokenStatus(prev: TokenStatus, next: TokenStatus): TokenStatus {
  if (!next.ok && next.transient && prev.ok) return prev;
  return { ...next, login: next.login ?? prev.login, avatarUrl: next.avatarUrl ?? prev.avatarUrl };
}

/**
 * public/_headers minus Strict-Transport-Security and upgrade-insecure-requests: this server speaks plain
 * HTTP to `tailscale serve`, which adds TLS. A test keeps the two in step.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self' https://api.github.com; manifest-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS } });

async function readFileIfExists(file: string): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    return (await stat(file)).isFile() ? new Uint8Array(await readFile(file)) : null;
  } catch {
    return null;
  }
}

async function serveStatic(distDir: string, pathname: string): Promise<Response> {
  const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", ...SECURITY_HEADERS } });
  const root = path.resolve(distDir);
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return notFound();
  }
  const file = path.resolve(root, `.${rel}`);
  if (file !== root && !file.startsWith(root + path.sep)) return notFound();
  const body = file === root ? null : await readFileIfExists(file);
  if (body) {
    const cache = rel.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
    return new Response(body, { headers: { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": cache, ...SECURITY_HEADERS } });
  }
  // A missing hashed asset is a real 404. Every other path is a client-side route (including /repo/vercel/next.js).
  if (rel.startsWith("/assets/")) return notFound();
  const index = await readFileIfExists(path.join(root, "index.html"));
  if (!index) return notFound();
  return new Response(index, { headers: { "Content-Type": TYPES[".html"], "Cache-Control": "no-cache", ...SECURITY_HEADERS } });
}

export type Handler = (request: Request) => Promise<Response>;

export interface HandlerDeps {
  config: SelfHostConfig;
  store: Store;
  token: () => TokenStatus;
  fetch: typeof fetch;
  now?: () => number;
}

export function createHandler({ config, store, token, fetch: fetchFn, now = Date.now }: HandlerDeps): Handler {
  const proxyCache = new MemoryCache();
  const quota = new QuotaGuard(100);
  const knownHosts = new Set(["localhost", "127.0.0.1", "[::1]", ...config.allowedHosts]);
  // A rebinding attacker's page sends its own domain as Host; only answer names that are ours.
  const hostAllowed = (hostname: string) => knownHosts.has(hostname) || hostname.endsWith(".ts.net");

  async function sync(request: Request, url: URL): Promise<Response> {
    try {
      if (request.method === "GET") {
        const since = Number(url.searchParams.get("since") ?? "0");
        if (!Number.isSafeInteger(since) || since < 0) return json({ error: "since must be a non-negative integer", code: "BAD_SINCE" }, 400);
        return json(store.pull(since));
      }
      if (request.method !== "POST") return json({ error: "Method not allowed", code: "METHOD" }, 405);
      // Requiring JSON also blocks cross-site form posts, which can't send this content type without a CORS preflight.
      if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "Expected application/json", code: "BAD_CONTENT_TYPE" }, 415);
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json({ error: "Request body too large", code: "BODY_TOO_LARGE" }, 413);
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return json({ error: "Body is not valid JSON", code: "BAD_JSON" }, 400);
      }
      return json({ results: store.push(validateChanges(body, now())) });
    } catch (e) {
      if (e instanceof ProtocolError) return json({ error: e.message, code: e.code, ...(e.index !== undefined ? { index: e.index } : {}) }, 400);
      console.error("[starvault] storage error", e);
      return json({ error: "Storage error", code: "STORE_ERROR" }, 500);
    }
  }

  return async (request) => {
    const url = new URL(request.url);
    if (!hostAllowed(url.hostname.toLowerCase())) {
      return json({ error: `Host "${url.hostname}" isn't allowed. Add it to ALLOWED_HOSTS if it's yours.`, code: "HOST_NOT_ALLOWED" }, 403);
    }
    if (url.pathname === "/api/instance") {
      const t = token();
      return json({ mode: "self-hosted", login: t.login, avatarUrl: t.avatarUrl, shareBaseUrl: config.shareBaseUrl, tokenOk: t.ok, ...(t.error ? { tokenError: t.error } : {}) });
    }
    if (url.pathname === "/api/sync") return sync(request, url);
    if (url.pathname.startsWith("/api/")) {
      return handleProxy(request, { token: config.token, fetch: fetchFn, cache: proxyCache, quota, selfHosted: true });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD", ...SECURITY_HEADERS } });
    }
    return serveStatic(config.distDir, url.pathname);
  };
}

/** Adapt a fetch-style handler to node:http, refusing bodies over MAX_BODY_BYTES. */
export function nodeListener(handle: Handler) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const tooLarge = () => {
      req.resume(); // discard the rest instead of resetting the socket mid-upload, so the client reads the 413
      res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Request body too large", code: "BODY_TOO_LARGE" }));
    };
    try {
      if (Number(req.headers["content-length"] ?? 0) > MAX_BODY_BYTES) return tooLarge();
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req as AsyncIterable<Buffer>) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) return tooLarge();
        chunks.push(chunk);
      }
      // Only the headers the handler reads; hop-by-hop headers can't be copied into a Request.
      const headers = new Headers();
      for (const name of ["content-type", "accept"]) {
        const value = req.headers[name];
        if (typeof value === "string") headers.set(name, value);
      }
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const request = new Request(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`, {
        method: req.method,
        headers,
        body: hasBody ? new Uint8Array(Buffer.concat(chunks)) : undefined,
      });
      const response = await handle(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(req.method === "HEAD" ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch (e) {
      console.error("[starvault]", e);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Internal error");
    }
  };
}
