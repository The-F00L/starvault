import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetProxyDetection, configureApi, fetchLists, fetchReadme, fetchStarred } from "./api";

const item = (id: number, full: string) => ({
  starred_at: "2024-10-14T08:00:00Z",
  repo: {
    id, full_name: full, name: full.split("/")[1], owner: { login: full.split("/")[0], avatar_url: "" }, description: null,
    html_url: "", homepage: null, language: null, topics: [], stargazers_count: 1, forks_count: 0, open_issues_count: 0,
    license: null, archived: false, fork: false, private: false, default_branch: "main", created_at: "", pushed_at: "",
  },
});
const jsonRes = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  __resetProxyDetection();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("fetchStarred", () => {
  it("pages through the proxy", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ items: [item(1, "a/one")], hasNext: true }))
      .mockResolvedValueOnce(jsonRes({ items: [item(2, "a/two")], hasNext: false }));
    const progress: number[] = [];
    const repos = await fetchStarred("octocat", (n) => progress.push(n));
    expect(repos.map((r) => r.fullName)).toEqual(["a/one", "a/two"]);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/users/octocat/starred?page=1", "/api/users/octocat/starred?page=2"]);
    expect(progress).toEqual([1, 2]);
  });

  it("falls back to api.github.com when the site has no proxy (SPA returns HTML)", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("<!doctype html>", { headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([item(1, "a/one")])));
    const repos = await fetchStarred("octocat");
    expect(repos.map((r) => r.fullName)).toEqual(["a/one"]);
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.github.com/users/octocat/starred?per_page=100");
    // Never sends credentials of any kind.
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBeUndefined();
  });

  it("rejects invalid usernames before any request", async () => {
    await expect(fetchStarred("../../user")).rejects.toThrow(/not a valid GitHub username/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces proxy errors", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ error: "Not found on GitHub" }, { status: 404 }));
    await expect(fetchStarred("ghost")).rejects.toThrow("Not found on GitHub");
  });
});

describe("quota reserve", () => {
  const paused = () => jsonRes({ error: "StarVault's shared GitHub quota is paused until 14:00 UTC", code: "QUOTA_RESERVE" }, { status: 503 });

  it("falls back to direct GitHub calls while the proxy protects its quota", async () => {
    fetchMock.mockResolvedValueOnce(paused()).mockResolvedValueOnce(new Response("# direct"));
    expect(await fetchReadme("astral-sh/uv")).toBe("# direct");
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.github.com/repos/astral-sh/uv/readme");
  });

  it("explains why Lists are unavailable", async () => {
    fetchMock.mockResolvedValueOnce(paused());
    await expect(fetchLists("octocat")).rejects.toThrow(/paused until 14:00 UTC\. Lists will be back/);
  });

  it("keeps using the proxy afterwards (the pause is not sticky)", async () => {
    fetchMock.mockResolvedValueOnce(paused()).mockResolvedValueOnce(new Response("# direct")).mockResolvedValueOnce(jsonRes({ markdown: "# proxied" }));
    await fetchReadme("a/b");
    expect(await fetchReadme("a/b")).toBe("# proxied");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/repos/a/b/readme");
  });
});

describe("fetchLists / fetchReadme", () => {
  it("lists need the proxy", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<!doctype html>", { headers: { "content-type": "text/html" } }));
    await expect(fetchLists("octocat")).rejects.toThrow(/need the StarVault proxy/);
  });

  it("encodes repo paths and validates them", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ markdown: "# hi" }));
    expect(await fetchReadme("astral-sh/uv")).toBe("# hi");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/repos/astral-sh/uv/readme");
    await expect(fetchReadme("../../x")).rejects.toThrow(/Invalid repository/);
  });
});

describe("the self-hosted owner's own stars", () => {
  // GitHub's anonymous API omits private stars. Falling back to it would make every private star look
  // unstarred, and "Sync stars" would then remove those repos from collections on every device.
  beforeEach(() => configureApi({ meLogin: "owner", useProxy: true }));
  const html = () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } });
  const paused = () => jsonRes({ error: "paused", code: "QUOTA_RESERVE" }, { status: 503 });

  it.each([
    ["a network error", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a non-JSON reply", () => Promise.resolve(html())],
    ["the quota reserve", () => Promise.resolve(paused())],
  ])("throw instead of falling back to the anonymous API on %s", async (_, fail) => {
    fetchMock.mockResolvedValueOnce(jsonRes({ items: [item(1, "a/one")], hasNext: true })).mockImplementationOnce(fail);
    await expect(fetchStarred("Owner")).rejects.toThrow(/couldn't read your stars/);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/me/starred?page=1", "/api/me/starred?page=2"]);
  });

  it("retry the server after a failure (it is not sticky)", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(jsonRes({ items: [item(1, "a/one")], hasNext: false }));
    await expect(fetchStarred("owner")).rejects.toThrow();
    expect((await fetchStarred("owner")).map((r) => r.fullName)).toEqual(["a/one"]);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/me/starred?page=1");
  });

  it("other users' stars still fall back", async () => {
    fetchMock.mockResolvedValueOnce(html()).mockResolvedValueOnce(new Response(JSON.stringify([item(1, "a/one")])));
    expect((await fetchStarred("octocat")).map((r) => r.fullName)).toEqual(["a/one"]);
  });
});
