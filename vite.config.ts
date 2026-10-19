import { configDefaults } from "vitest/config";
import { defineConfig, loadEnv, type Plugin } from "vite";
import type { IncomingMessage } from "node:http";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createRateLimiter, handleProxy } from "./server/proxy";

/** Serve the same /api proxy as the Cloudflare Worker during `vite dev`. */
function devProxy(token: string): Plugin {
  const allow = createRateLimiter();
  return {
    name: "starvault-dev-proxy",
    configureServer(server) {
      server.middlewares.use("/api", async (req: IncomingMessage, res) => {
        const response = await handleProxy(new Request(`http://localhost/api${req.url ?? ""}`, { method: req.method }), {
          token,
          fetch,
          allow,
        });
        res.statusCode = response.status;
        response.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(await response.text());
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // GITHUB_TOKEN from .env.local (never prefixed with VITE_, so it is not exposed to the client bundle).
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), tailwindcss(), devProxy(env.GITHUB_TOKEN ?? "")],
    test: { environment: "node", exclude: [...configDefaults.exclude, "e2e/**"] },
  };
});
