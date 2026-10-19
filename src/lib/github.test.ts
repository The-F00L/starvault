import { describe, expect, it } from "vitest";
import { mapStarredItem, nextLink, repoApiPath } from "./github";

const item = {
  starred_at: "2024-10-14T08:00:00Z",
  repo: {
    id: 1,
    full_name: "astral-sh/uv",
    name: "uv",
    owner: { login: "astral-sh", avatar_url: "https://avatars/a" },
    description: "fast",
    html_url: "https://github.com/astral-sh/uv",
    homepage: "",
    language: "Rust",
    topics: ["python"],
    stargazers_count: 32451,
    forks_count: 1189,
    subscribers_count: 421,
    open_issues_count: 214,
    license: { spdx_id: "MIT" },
    archived: false,
    fork: false,
    private: false,
    default_branch: "main",
    created_at: "2023-10-01T00:00:00Z",
    pushed_at: "2026-09-26T00:00:00Z",
  },
};

describe("mapStarredItem", () => {
  it("maps the star+json payload onto Repo", () => {
    const r = mapStarredItem(item);
    expect(r).toMatchObject({
      fullName: "astral-sh/uv",
      owner: "astral-sh",
      stars: 32451,
      watchers: 421,
      license: "MIT",
      homepage: null,
      starredAt: "2024-10-14T08:00:00Z",
      source: "github",
    });
  });

  it("treats NOASSERTION licenses as unknown", () => {
    expect(mapStarredItem({ ...item, repo: { ...item.repo, license: { spdx_id: "NOASSERTION" } } }).license).toBeNull();
  });
});

describe("nextLink", () => {
  it("extracts rel=next from a Link header", () => {
    const h = '<https://api.github.com/user/starred?page=2>; rel="next", <https://api.github.com/user/starred?page=9>; rel="last"';
    expect(nextLink(h)).toBe("https://api.github.com/user/starred?page=2");
    expect(nextLink(null)).toBeNull();
    expect(nextLink('<https://x?page=1>; rel="prev"')).toBeNull();
  });
});

describe("repoApiPath", () => {
  it("accepts normal names and rejects traversal", () => {
    expect(repoApiPath("astral-sh/uv")).toBe("astral-sh/uv");
    expect(repoApiPath("a.b/c_d-e.js")).toBe("a.b/c_d-e.js");
    for (const bad of ["../../repos/me/r/git/refs/heads/main", "a/..", "./x", "a/b/c", "a", "a/%2e%2e", "a/b?x=1", ""]) {
      expect(() => repoApiPath(bad), bad).toThrow(/Invalid repository/);
    }
  });

});
