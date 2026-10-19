/** Entry point of the self-hosted server, bundled to dist-server/selfhost.mjs (`npm run build:server`). */
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { assertSafeBind, checkToken, createHandler, loadConfig, nextTokenStatus, nodeListener, type TokenStatus } from "./selfhost";
import { Store } from "./store";

const config = loadConfig(process.env);
assertSafeBind(config);
mkdirSync(config.dataDir, { recursive: true });
const store = new Store(path.join(config.dataDir, "starvault.sqlite"));

let token: TokenStatus = { ok: false, login: null, avatarUrl: null, error: "Token not checked yet" };
async function refreshToken() {
  const next = await checkToken(config.token, fetch);
  token = nextTokenStatus(token, next);
  if (!next.ok) console.warn(`[starvault] ${next.error}${token.ok ? " (keeping the last good token status)" : ""}`);
}
await refreshToken();
// checkToken never throws, but an unhandled rejection here would kill the server: keep a backstop.
setInterval(() => refreshToken().catch((e) => console.error("[starvault] token check failed", e)), 10 * 60_000).unref();

const handler = createHandler({ config, store, token: () => token, fetch: (input, init) => fetch(input, init) });
createServer(nodeListener(handler)).listen(config.port, config.host, () => {
  console.log(`[starvault] self-hosted on http://${config.host}:${config.port} (data in ${config.dataDir})`);
});
