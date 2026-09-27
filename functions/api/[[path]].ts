// Cloudflare Pages Function: mounts the read-only GitHub proxy at /api/*.
import { createRateLimiter, handleProxy, type ProxyEnv } from "../../server/proxy";

interface Env {
  /** Fine-grained PAT with no permissions (public data only). Set with `wrangler pages secret put GITHUB_TOKEN`. */
  GITHUB_TOKEN?: string;
}

const allow = createRateLimiter();

export const onRequest = async (context: { request: Request; env: Env }) =>
  handleProxy(context.request, {
    token: context.env.GITHUB_TOKEN ?? "",
    fetch: (input, init) => fetch(input, init),
    cache: (globalThis as unknown as { caches: { default: ProxyEnv["cache"] } }).caches.default,
    allow,
  });
