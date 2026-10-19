import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSafeBind, checkToken, createHandler, loadConfig, nextTokenStatus, nodeListener, SECURITY_HEADERS, type TokenStatus } from "./selfhost";
import { Store } from "./store";

const NOW = Date.parse("2026-10-12T12:00:00.000Z");
const at = "2026-10-12T11:00:00.000Z";
const okToken: TokenStatus = { ok: true, login: "octo", avatarUrl: "https://avatars.example/octo" };

function setup(opts: { token?: TokenStatus; env?: Record<string, string> } = {}) {
  const dist = mkdtempSync(path.join(tmpdir(), "sv-dist-"));
  mkdirSync(path.join(dist, "assets"));
  writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>StarVault</title>");
  writeFileSync(path.join(dist, "assets", "app-123.js"), "console.log(1)");
  const store = new Store(":memory:");
  const fetchMock = vi.fn(async () => new Response("[]"));
  const config = loadConfig({ DIST_DIR: dist, GITHUB_TOKEN: "tok", SHARE_BASE_URL: "https://sv.example.workers.dev/", ...opts.env });
  const handler = createHandler({ config, store, token: () => opts.token ?? okToken, fetch: fetchMock as unknown as typeof fetch, now: () => NOW });
  const call = (p: string, init?: RequestInit, host = "localhost:8787") => handler(new Request(`http://${host}${p}`, init));
  return { call, store, fetchMock, handler, dist };
}
const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});
const meta = (note = "n") => ({ kind: "meta", key: "a/b", updatedAt: at, deleted: false, data: { fullName: "a/b", note, tags: [], pinned: false, updatedAt: at } });

describe("config", () => {
  it("has safe defaults", () => {
    expect(loadConfig({})).toEqual({
      host: "127.0.0.1", port: 8787, dataDir: "/data", distDir: "dist", token: "", shareBaseUrl: null, allowPublicBind: false, allowedHosts: [],
    });
  });

  it("normalises SHARE_BASE_URL and ALLOWED_HOSTS, and rejects non-http share URLs", () => {
    const c = loadConfig({ SHARE_BASE_URL: "https://sv.example.workers.dev//", ALLOWED_HOSTS: " Homelab , 100.64.0.1" });
    expect(c.shareBaseUrl).toBe("https://sv.example.workers.dev");
    expect(c.allowedHosts).toEqual(["homelab", "100.64.0.1"]);
    expect(() => loadConfig({ SHARE_BASE_URL: "javascript:alert(1)" })).toThrow(/SHARE_BASE_URL/);
  });

  it("refuses to bind every interface unless ALLOW_PUBLIC_BIND=1", () => {
    for (const HOST of ["0.0.0.0", "::", ""]) expect(() => assertSafeBind(loadConfig({ HOST }))).toThrow(/ALLOW_PUBLIC_BIND/);
    expect(() => assertSafeBind(loadConfig({ HOST: "0.0.0.0", ALLOW_PUBLIC_BIND: "1" }))).not.toThrow();
    expect(() => assertSafeBind(loadConfig({}))).not.toThrow();
  });
});

describe("checkToken", () => {
  it("reports the owner, or why the token can't be used", async () => {
    const reply = (res: Response | Error) => (async () => { if (res instanceof Error) throw res; return res; }) as unknown as typeof fetch;
    expect(await checkToken("t", reply(new Response(JSON.stringify({ login: "octo", avatar_url: "a" }))))).toEqual({ ok: true, login: "octo", avatarUrl: "a" });
    expect(await checkToken("t", reply(new Response("", { status: 401 })))).toMatchObject({ ok: false, error: expect.stringMatching(/expired|revoked/) });
    expect(await checkToken("", reply(new Response("")))).toMatchObject({ ok: false, error: "GITHUB_TOKEN is not set" });
    expect(await checkToken("t", reply(new TypeError("offline")))).toMatchObject({ ok: false, error: expect.stringMatching(/reach GitHub/) });
  });

  it("doesn't throw on a reply that isn't the user JSON (captive portal, proxy page)", async () => {
    const reply = (res: Response) => (async () => res) as unknown as typeof fetch;
    expect(await checkToken("t", reply(new Response("<html>Sign in to the Wi-Fi</html>")))).toMatchObject({ ok: false, transient: true });
    expect(await checkToken("t", reply(new Response(JSON.stringify({ message: "hi" }))))).toMatchObject({ ok: false, transient: true });
  });

  it("tells a token problem apart from a passing outage", async () => {
    const reply = (res: Response | Error) => (async () => { if (res instanceof Error) throw res; return res; }) as unknown as typeof fetch;
    expect(await checkToken("t", reply(new TypeError("offline")))).toMatchObject({ transient: true });
    expect(await checkToken("t", reply(new Response("", { status: 502 })))).toMatchObject({ transient: true });
    expect(await checkToken("t", reply(new Response("", { status: 401 })))).not.toHaveProperty("transient");
    expect(await checkToken("t", reply(new Response("", { status: 403 })))).toMatchObject({ ok: false, error: expect.stringMatching(/rejected|permission/) });
    expect(await checkToken("t", reply(new Response("", { status: 403 })))).not.toHaveProperty("transient");
    expect(await checkToken("", reply(new Response("")))).not.toHaveProperty("transient");
  });

  it("treats a rate-limited 403 as passing, not as a broken token", async () => {
    const reply = (res: Response) => (async () => res) as unknown as typeof fetch;
    const limited = new Response(JSON.stringify({ message: "API rate limit exceeded" }), { status: 403, headers: { "x-ratelimit-remaining": "0" } });
    expect(await checkToken("t", reply(limited))).toMatchObject({ ok: false, transient: true });
    const secondary = new Response(JSON.stringify({ message: "You have exceeded a secondary rate limit" }), { status: 403 });
    expect(await checkToken("t", reply(secondary))).toMatchObject({ ok: false, transient: true });
    expect(await checkToken("t", reply(new Response("", { status: 429 })))).toMatchObject({ transient: true });
  });
});

describe("nextTokenStatus", () => {
  const outage: TokenStatus = { ok: false, login: null, avatarUrl: null, error: "Couldn't reach GitHub to check the token", transient: true };
  const rejected: TokenStatus = { ok: false, login: null, avatarUrl: null, error: "GitHub rejected the token" };

  it("keeps the last good status through a passing outage", () => {
    expect(nextTokenStatus(okToken, outage)).toEqual(okToken);
  });

  it("reports an outage when there was never a good status", () => {
    const initial: TokenStatus = { ok: false, login: null, avatarUrl: null, error: "Token not checked yet" };
    expect(nextTokenStatus(initial, outage)).toMatchObject({ ok: false, error: outage.error });
  });

  it("reports a token problem right away, keeping the known owner", () => {
    expect(nextTokenStatus(okToken, rejected)).toMatchObject({ ok: false, login: "octo", avatarUrl: okToken.avatarUrl, error: rejected.error });
  });

  it("takes a good status", () => {
    const other: TokenStatus = { ok: true, login: "octo2", avatarUrl: "b" };
    expect(nextTokenStatus({ ...rejected, login: "octo" }, other)).toEqual(other);
  });
});

describe("GET /api/instance", () => {
  it("describes the instance", async () => {
    const res = await setup().call("/api/instance");
    expect(await res.json()).toEqual({
      mode: "self-hosted", login: "octo", avatarUrl: "https://avatars.example/octo", shareBaseUrl: "https://sv.example.workers.dev", tokenOk: true,
    });
  });

  it("reports a token problem", async () => {
    const res = await setup({ token: { ok: false, login: null, avatarUrl: null, error: "GitHub rejected the token" } }).call("/api/instance");
    expect(await res.json()).toMatchObject({ tokenOk: false, tokenError: "GitHub rejected the token", login: null });
  });
});

describe("Host allow-list (DNS rebinding)", () => {
  it("only answers known host names", async () => {
    const { call } = setup({ env: { ALLOWED_HOSTS: "homelab" } });
    expect((await call("/api/instance", undefined, "evil.example")).status).toBe(403);
    expect((await call("/", undefined, "evil.example")).status).toBe(403);
    for (const host of ["localhost:8787", "127.0.0.1:8787", "[::1]:8787", "homelab.tail1234.ts.net", "homelab:8787"]) {
      expect((await call("/api/instance", undefined, host)).status, host).toBe(200);
    }
  });
});

describe("/api/sync", () => {
  it("stores pushed changes and serves them to pulls", async () => {
    const { call } = setup();
    const pushed = await (await call("/api/sync", post({ changes: [meta("hello")] }))).json();
    expect(pushed.results[0]).toMatchObject({ key: "a/b", rev: 1, data: { note: "hello" } });
    const page = await (await call("/api/sync?since=0")).json();
    expect(page).toMatchObject({ rev: 1, more: false, changes: [{ key: "a/b" }] });
  });

  it("validates input", async () => {
    const { call } = setup();
    const code = async (init: RequestInit, p = "/api/sync") => {
      const res = await call(p, init);
      return [res.status, (await res.json()).code];
    };
    expect(await code({ method: "POST", body: JSON.stringify({ changes: [] }) })).toEqual([415, "BAD_CONTENT_TYPE"]);
    expect(await code(post("{nope"))).toEqual([400, "BAD_JSON"]);
    expect(await code(post({ changes: Array.from({ length: 501 }, () => meta()) }))).toEqual([400, "BATCH_TOO_LARGE"]);
    expect(await code(post({ changes: [{ ...meta(), updatedAt: "2026-10-12T12:30:00.000Z" }] }))).toEqual([400, "FUTURE_TIMESTAMP"]);
    expect(await code(post({ changes: [meta("x".repeat(20_001))] }))).toEqual([400, "NOTE_TOO_LARGE"]);
    expect(await code(post("x".repeat(1_000_001)))).toEqual([413, "BODY_TOO_LARGE"]);
    expect(await code({}, "/api/sync?since=-1")).toEqual([400, "BAD_SINCE"]);
    expect(await code({ method: "DELETE" })).toEqual([405, "METHOD"]);
  });

  it("says which change was bad", async () => {
    const res = await setup().call("/api/sync", post({ changes: [meta(), { ...meta(), kind: "repo" }] }));
    expect(await res.json()).toMatchObject({ code: "BAD_KIND", index: 1 });
  });

  it("answers 500 with a code when storage fails", async () => {
    const { call, store } = setup();
    store.close();
    const res = await call("/api/sync?since=0");
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("STORE_ERROR");
  });
});

describe("GitHub proxy", () => {
  it("serves /api/me/* with the owner's token", async () => {
    const { call, fetchMock } = setup();
    expect((await call("/api/me/starred?page=1")).status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://api.github.com/user/starred?per_page=100&page=1");
    expect(init.headers.Authorization).toBe("Bearer tok");
  });
});

describe("static files", () => {
  it("falls back to index.html for app routes, dotted repo names included", async () => {
    const { call } = setup();
    for (const p of ["/", "/collections", "/repo/vercel/next.js"]) {
      const res = await call(p);
      expect(res.status, p).toBe(200);
      expect(await res.text()).toContain("<title>StarVault</title>");
      expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    }
  });

  it("serves hashed assets as immutable and 404s missing ones", async () => {
    const { call } = setup();
    const res = await call("/assets/app-123.js");
    expect(res.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect((await call("/assets/missing.js")).status).toBe(404);
  });

  it("never serves files outside dist/", async () => {
    // The URL parser already folds %2e%2e into /package.json, so this lands on the SPA fallback, never the real file.
    const res = await setup().call("/%2e%2e/package.json");
    const text = await res.text();
    expect(text).toContain("<title>StarVault</title>");
    expect(text).not.toContain('"scripts"');
  });

  it("stops encoded-slash traversal at the containment check", async () => {
    const { call, dist } = setup();
    // A sibling of dist/ that a missing guard would happily serve.
    const sibling = `${path.basename(dist)}-secret.txt`;
    writeFileSync(path.join(path.dirname(dist), sibling), "TOP SECRET");
    for (const p of [`/..%2f${sibling}`, `/assets/..%2f..%2f${sibling}`]) {
      const res = await call(p);
      expect(res.status, p).toBe(404);
      expect(await res.text(), p).not.toContain("TOP SECRET");
    }
  });

  it("rejects non-GET methods", async () => {
    expect((await setup().call("/", { method: "POST" })).status).toBe(405);
  });

  it("sends the same security headers as public/_headers, minus HSTS and upgrade-insecure-requests", () => {
    const block = readFileSync("public/_headers", "utf8").split(/\n\s*\n/).find((b) => /^\/\*$/m.test(b))!;
    const expected: Record<string, string> = Object.fromEntries(
      block
        .split("\n")
        .filter((l) => /^\s+\S+:/.test(l))
        .map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]),
    );
    delete expected["Strict-Transport-Security"];
    expected["Content-Security-Policy"] = expected["Content-Security-Policy"].replace(/;\s*upgrade-insecure-requests/, "");
    expect(SECURITY_HEADERS).toEqual(expected);
  });
});

describe("nodeListener", () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  async function listen() {
    server = createServer(nodeListener(setup().handler));
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  it("round-trips requests, HEAD included", async () => {
    const base = await listen();
    expect(await (await fetch(`${base}/api/instance`)).json()).toMatchObject({ mode: "self-hosted" });
    const head = await fetch(`${base}/`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const pushed = await fetch(`${base}/api/sync`, post({ changes: [meta()] }));
    expect(pushed.status).toBe(200);
  });

  it("refuses bodies over 1 MB before reading them", async () => {
    const base = await listen();
    const res = await fetch(`${base}/api/sync`, post("x".repeat(1_000_001)));
    expect(res.status).toBe(413);
  });
});
