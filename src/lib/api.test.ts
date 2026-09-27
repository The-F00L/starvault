import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetProxyDetection, fetchLists, fetchReadme, fetchStarred } from "./api";

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
