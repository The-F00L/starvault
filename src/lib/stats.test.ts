import { describe, expect, it } from "vitest";
import type { Collection, Repo, RepoMeta } from "./types";
import {
  collectionMarkdown,
  filterRepos,
  healthOf,
  healthBreakdown,
  languageBreakdown,
  sortRepos,
  staleCandidates,
  starsByMonth,
  suggestCollections,
  summary,
  topTopics,
} from "./stats";

const NOW = new Date("2026-09-27T12:00:00Z").getTime();
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function repo(p: Partial<Repo> & { fullName: string }): Repo {
  const [owner, name] = p.fullName.split("/");
  return {
    id: Math.floor(Math.random() * 1e9),
    owner,
    name,
    ownerAvatar: "",
    description: null,
    htmlUrl: `https://github.com/${p.fullName}`,
    homepage: null,
    language: null,
    topics: [],
    stars: 0,
    forks: 0,
    watchers: 0,
    openIssues: 0,
    license: null,
    archived: false,
    fork: false,
    isPrivate: false,
    defaultBranch: "main",
    createdAt: daysAgo(1000),
    pushedAt: daysAgo(1),
    starredAt: daysAgo(10),
    source: "mock",
    ...p,
  };
}

describe("healthOf", () => {
  it("classifies by archive flag and last push", () => {
    expect(healthOf(repo({ fullName: "a/a", archived: true, pushedAt: daysAgo(1) }), NOW)).toBe("archived");
    expect(healthOf(repo({ fullName: "a/b", pushedAt: daysAgo(10) }), NOW)).toBe("active");
    expect(healthOf(repo({ fullName: "a/c", pushedAt: daysAgo(200) }), NOW)).toBe("maintained");
    expect(healthOf(repo({ fullName: "a/d", pushedAt: daysAgo(600) }), NOW)).toBe("stale");
  });

  it("breaks down counts per bucket", () => {
    const repos = [
      repo({ fullName: "a/a", archived: true }),
      repo({ fullName: "a/b", pushedAt: daysAgo(3) }),
      repo({ fullName: "a/c", pushedAt: daysAgo(3) }),
    ];
    expect(healthBreakdown(repos, NOW)).toEqual({ active: 2, maintained: 0, stale: 0, archived: 1 });
  });
});

describe("staleCandidates", () => {
  it("flags repos starred over 2 years ago that are archived or dormant 18mo+", () => {
    const repos = [
      repo({ fullName: "old/archived", starredAt: daysAgo(900), archived: true }),
      repo({ fullName: "old/dormant", starredAt: daysAgo(900), pushedAt: daysAgo(700) }),
      repo({ fullName: "old/alive", starredAt: daysAgo(900), pushedAt: daysAgo(5) }),
      repo({ fullName: "new/archived", starredAt: daysAgo(30), archived: true }),
    ];
    expect(staleCandidates(repos, NOW).map((r) => r.fullName)).toEqual(["old/archived", "old/dormant"]);
  });
});

describe("languageBreakdown", () => {
  it("groups the long tail into Others", () => {
    const repos = [
      ...Array.from({ length: 3 }, (_, i) => repo({ fullName: `r/${i}`, language: "Rust" })),
      ...Array.from({ length: 2 }, (_, i) => repo({ fullName: `t/${i}`, language: "TypeScript" })),
      repo({ fullName: "x/1", language: "Zig" }),
      repo({ fullName: "x/2", language: null }),
    ];
    expect(languageBreakdown(repos, 2)).toEqual([
      { language: "Rust", count: 3 },
      { language: "TypeScript", count: 2 },
      { language: "Others", count: 2 },
    ]);
  });
});

describe("summary", () => {
  it("computes the headline metrics", () => {
    const repos = [
      repo({ fullName: "a/a", language: "Rust", starredAt: "2024-03-01T00:00:00Z", createdAt: daysAgo(365 * 2), pushedAt: daysAgo(10) }),
      repo({ fullName: "a/b", language: "Rust", starredAt: "2024-05-01T00:00:00Z", createdAt: daysAgo(365 * 4), pushedAt: daysAgo(400) }),
      repo({ fullName: "a/c", language: "Go", starredAt: "2023-05-01T00:00:00Z", createdAt: daysAgo(365 * 3), archived: true }),
    ];
    const s = summary(repos, NOW);
    expect(s.total).toBe(3);
    expect(s.dominantLanguage).toEqual({ language: "Rust", share: 2 / 3 });
    expect(s.apexYear).toEqual({ year: 2024, count: 2 });
    expect(s.avgAgeYears).toBeCloseTo(3, 1);
    expect(s.maintenanceRatio).toBeCloseTo(1 / 3);
  });

  it("handles an empty vault", () => {
    const s = summary([], NOW);
    expect(s.total).toBe(0);
    expect(s.dominantLanguage).toBeNull();
    expect(s.apexYear).toBeNull();
    expect(s.maintenanceRatio).toBe(0);
  });
});

describe("starsByMonth", () => {
  it("fills empty months between first and last star", () => {
    const repos = [
      repo({ fullName: "a/a", starredAt: "2025-01-15T00:00:00Z" }),
      repo({ fullName: "a/b", starredAt: "2025-03-02T00:00:00Z" }),
      repo({ fullName: "a/c", starredAt: "2025-03-20T00:00:00Z" }),
    ];
    expect(starsByMonth(repos)).toEqual([
      { month: "2025-01", count: 1 },
      { month: "2025-02", count: 0 },
      { month: "2025-03", count: 2 },
    ]);
  });
});

describe("topTopics", () => {
  it("ranks topics by frequency", () => {
    const repos = [
      repo({ fullName: "a/a", topics: ["cli", "rust"] }),
      repo({ fullName: "a/b", topics: ["cli"] }),
    ];
    expect(topTopics(repos, 5)).toEqual([
      { topic: "cli", count: 2 },
      { topic: "rust", count: 1 },
    ]);
  });
});

describe("filterRepos / sortRepos", () => {
  const repos = [
    repo({ fullName: "astral-sh/uv", description: "Fast Python installer", language: "Rust", topics: ["python"], stars: 30, starredAt: daysAgo(5) }),
    repo({ fullName: "facebook/react", description: "UI library", language: "JavaScript", topics: ["ui"], stars: 200, starredAt: daysAgo(50) }),
  ];
  const meta = new Map<string, RepoMeta>([
    ["facebook/react", { fullName: "facebook/react", note: "tracking compiler", tags: ["frontend"], pinned: false, updatedAt: "" }],
  ]);

  it("matches query against name, description, topics and notes", () => {
    expect(filterRepos(repos, meta, { q: "python" }).map((r) => r.name)).toEqual(["uv"]);
    expect(filterRepos(repos, meta, { q: "compiler" }).map((r) => r.name)).toEqual(["react"]);
  });

  it("filters by language and tags (topics or user tags)", () => {
    expect(filterRepos(repos, meta, { language: "Rust" }).map((r) => r.name)).toEqual(["uv"]);
    expect(filterRepos(repos, meta, { tags: ["frontend"] }).map((r) => r.name)).toEqual(["react"]);
    expect(filterRepos(repos, meta, { tags: ["python"] }).map((r) => r.name)).toEqual(["uv"]);
  });

  it("sorts by stars and recency", () => {
    expect(sortRepos(repos, "stars").map((r) => r.name)).toEqual(["react", "uv"]);
    expect(sortRepos(repos, "starred").map((r) => r.name)).toEqual(["uv", "react"]);
  });
});

describe("suggestCollections", () => {
  const collections: Collection[] = [
    { id: "ai", name: "AI & ML", icon: "", description: "", rules: ["llm", "ai"], createdAt: "", updatedAt: "" },
    { id: "rust", name: "Rust CLI", icon: "", description: "", rules: ["cli"], createdAt: "", updatedAt: "" },
    { id: "db", name: "Databases", icon: "", description: "", rules: ["database"], createdAt: "", updatedAt: "" },
  ];

  it("ranks collections by rule matches against topics, language and description", () => {
    const r = repo({ fullName: "ggml/llama.cpp", language: "C++", topics: ["llm", "ai", "cli"] });
    expect(suggestCollections(r, collections, 2).map((c) => c.id)).toEqual(["ai", "rust"]);
  });

  it("returns nothing when no rule matches", () => {
    expect(suggestCollections(repo({ fullName: "x/y", topics: ["games"] }), collections, 2)).toEqual([]);
  });
});

describe("collectionMarkdown", () => {
  it("renders an awesome-list", () => {
    const c: Collection = { id: "ai", name: "AI & ML", icon: "", description: "LLM tooling", rules: [], createdAt: "", updatedAt: "" };
    const md = collectionMarkdown(c, [repo({ fullName: "ollama/ollama", description: "Run LLMs locally", stars: 98600 })]);
    expect(md).toContain("# Awesome AI & ML");
    expect(md).toContain("LLM tooling");
    expect(md).toContain("- [ollama/ollama](https://github.com/ollama/ollama) - Run LLMs locally ⭐ 98.6k");
  });
});
