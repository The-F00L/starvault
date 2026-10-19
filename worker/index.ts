/**
 * Cloudflare Worker: serves the static app (dist/) and the read-only GitHub proxy at /api/*.
 * Runs on a free *.workers.dev subdomain — no custom domain needed.
 */
import { createRateLimiter, handleProxy, MemoryCache, QuotaGuard, tieredCache, type ProxyEnv } from "../server/proxy";

interface Env {
  /** Static assets from dist/ (configured in wrangler.jsonc). */
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Fine-grained PAT of a dedicated machine account, with no permissions. `wrangler secret put GITHUB_TOKEN`. */
  GITHUB_TOKEN?: string;
  /** Cloudflare Rate Limiting binding (see wrangler.jsonc). */
  API_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

// Per-isolate state. The rate-limit binding and quota reserve are the real protections;
// these are cheap extra layers.
const quota = new QuotaGuard(1000);
const memory = new MemoryCache();
const fallbackLimiter = createRateLimiter();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const edge = (globalThis as unknown as { caches?: { default: NonNullable<ProxyEnv["cache"]> } }).caches?.default;
    return handleProxy(request, {
      token: env.GITHUB_TOKEN ?? "",
      fetch: (input, init) => fetch(input, init),
      cache: edge ? tieredCache(memory, edge) : memory,
      allow: env.API_RATE_LIMITER
        ? async (ip) => (await env.API_RATE_LIMITER!.limit({ key: ip })).success
        : fallbackLimiter,
      quota,
    });
  },
};
