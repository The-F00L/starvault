import { describe, expect, it, vi } from "vitest";
import { createRateLimiter, handleProxy, parseRoute, type ProxyEnv } from "./proxy";

const u = (path: string) => new URL(`https://sv.example${path}`);
const req = (path: string, init?: RequestInit) => new Request(`https://sv.example${path}`, init);

describe("parseRoute", () => {
  it("accepts the allow-listed routes", () => {
    expect(parseRoute(u("/api/users/octo-cat"))).toEqual({ kind: "user", login: "octo-cat" });
    expect(parseRoute(u("/api/users/octocat/starred?page=3"))).toEqual({ kind: "starred", login: "octocat", page: 3 });
    expect(parseRoute(u("/api/users/octocat/lists"))).toEqual({ kind: "lists", login: "octocat" });
    expect(parseRoute(u("/api/repos/astral-sh/uv/readme"))).toMatchObject({ kind: "repo", owner: "astral-sh", name: "uv", resource: "readme" });
  });

  it("rejects everything else", () => {
    for (const p of [
      "/api/users/-bad",
      "/api/users/a--b",
      "/api/users/octocat/starred?page=0",
      "/api/users/octocat/starred?page=1.5",
      "/api/users/octocat/starred?page=9999",
      "/api/users/octocat/followers",
      "/api/repos/a/../readme",
      "/api/repos/a/b/git",
      "/api/repos/a/b/c/readme",
      "/api/graphql",
      "/api/user",
    ]) {
      expect(parseRoute(u(p)), p).toBeNull();
    }
  });
});

function env(responses: Response[], extra: Partial<ProxyEnv> = {}): ProxyEnv & { fetch: ReturnType<typeof vi.fn> } {
  const fetchMock = vi.fn();
  for (const r of responses) fetchMock.mockResolvedValueOnce(r);
  return { token: "secret-token", fetch: fetchMock, ...extra } as ProxyEnv & { fetch: ReturnType<typeof vi.fn> };
}

describe("handleProxy", () => {
  it("only allows GET", async () => {
    const res = await handleProxy(req("/api/users/octocat", { method: "POST" }), env([]));
    expect(res.status).toBe(405);
  });

  it("returns 404 for unknown routes without calling GitHub", async () => {
    const e = env([]);
    expect((await handleProxy(req("/api/rate_limit"), e)).status).toBe(404);
    expect(e.fetch).not.toHaveBeenCalled();
  });

  it("maps a user and never echoes the token", async () => {
    const e = env([new Response(JSON.stringify({ login: "octocat", name: "Octo", avatar_url: "a", bio: null, html_url: "h", email: "x@y" }))]);
    const res = await handleProxy(req("/api/users/octocat"), e);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ login: "octocat", name: "Octo", avatarUrl: "a", bio: null, htmlUrl: "h" });
    expect(text).not.toContain("secret-token");
    expect(e.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer secret-token");
  });

  it("pages starred repos and reports hasNext", async () => {
    const e = env([new Response("[]", { headers: { Link: '<x>; rel="next"' } })]);
    const body = await (await handleProxy(req("/api/users/octocat/starred?page=2&junk=1"), e)).json();
    expect(body).toEqual({ items: [], hasNext: true });
    expect(e.fetch.mock.calls[0][0]).toBe("https://api.github.com/users/octocat/starred?per_page=100&page=2");
  });

  it("returns only public lists", async () => {
    const list = (id: string, isPrivate: boolean) => ({
      id, name: id, description: null, isPrivate, slug: id, createdAt: "", updatedAt: "",
      items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ nameWithOwner: "a/b" }] },
    });
    const e = env([new Response(JSON.stringify({ data: { user: { lists: { nodes: [list("pub", false), list("priv", true)] } } } }))]);
    const body = await (await handleProxy(req("/api/users/octocat/lists"), e)).json();
    expect(body.map((l: { id: string }) => l.id)).toEqual(["pub"]);
    expect(body[0].repos).toEqual(["a/b"]);
  });

  it("maps GitHub rate limiting to 503 and not-found to 404", async () => {
    expect((await handleProxy(req("/api/users/octocat"), env([new Response("", { status: 403 })]))).status).toBe(503);
    expect((await handleProxy(req("/api/users/nobody"), env([new Response("", { status: 404 })]))).status).toBe(404);
  });

  it("serves repeat requests from cache", async () => {
    const store = new Map<string, Response>();
    const cache = {
      match: async (r: Request) => store.get(r.url)?.clone(),
      put: async (r: Request, res: Response) => void store.set(r.url, res),
    };
    const e = env([new Response(JSON.stringify({ login: "octocat" }))], { cache });
    await handleProxy(req("/api/users/octocat?bust=1"), e);
    const second = await handleProxy(req("/api/users/octocat?bust=2"), e);
    expect(second.status).toBe(200);
    expect(e.fetch).toHaveBeenCalledTimes(1);
  });

  it("rate limits per IP", async () => {
    const e = env([], { allow: createRateLimiter(1) });
    e.fetch.mockResolvedValue(new Response(JSON.stringify({ login: "o" })));
    const h = { headers: { "CF-Connecting-IP": "1.2.3.4" } };
    expect((await handleProxy(req("/api/users/octocat", h), e)).status).toBe(200);
    expect((await handleProxy(req("/api/users/octocat", h), e)).status).toBe(429);
  });
});
