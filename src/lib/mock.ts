import { db } from "./db";
import type { Collection, CollectionItem, Repo, RepoMeta } from "./types";

// [fullName, description, language, stars, forks, topics, license, starredDaysAgo, pushedDaysAgo, createdYearsAgo, archived?]
type Row = [string, string, string | null, number, number, string[], string | null, number, number, number, boolean?];

const ROWS: Row[] = [
  ["astral-sh/uv", "An extremely fast Python package and project manager, written in Rust.", "Rust", 32451, 1189, ["python", "packaging", "cli", "rust"], "Apache-2.0", 2, 0, 2.9],
  ["shadcn-ui/ui", "Beautifully designed components that you can copy and paste into your apps. Accessible. Customizable. Open Source.", "TypeScript", 68200, 5900, ["react", "tailwindcss", "components", "ui"], "MIT", 5, 1, 3.7],
  ["ollama/ollama", "Get up and running with Llama 3.3, Mistral, Gemma 2, and other large language models.", "Go", 98600, 7800, ["llm", "ai", "local-first", "llama"], "MIT", 1, 0, 3.2],
  ["facebook/react", "The library for web and native user interfaces.", "JavaScript", 228000, 45900, ["react", "ui", "frontend", "javascript"], "MIT", 30, 0, 13],
  ["tursodatabase/limbo", "Limbo is an interactive SQL shell and SQLite-compatible database engine completely rewritten in pure Rust.", "Rust", 7900, 320, ["database", "sqlite", "rust"], "MIT", 1, 1, 1.8],
  ["vllm-project/vllm", "A high-throughput and memory-efficient inference and serving engine for LLMs.", "Python", 31800, 4500, ["llm", "inference", "deep-learning", "ai"], "Apache-2.0", 40, 0, 3.3],
  ["biomejs/biome", "A toolchain for web projects, aimed to provide functionalities to maintain them.", "Rust", 16400, 580, ["linter", "formatter", "rust", "javascript"], "MIT", 60, 0, 3],
  ["supabase/supabase", "The Postgres development platform. Supabase gives you a dedicated Postgres database to build your web, mobile, and AI applications.", "TypeScript", 74100, 6200, ["database", "postgres", "auth", "realtime"], "Apache-2.0", 120, 0, 5.6],
  ["tailwindlabs/tailwindcss", "A utility-first CSS framework for rapid UI development.", "TypeScript", 81400, 4100, ["css", "tailwindcss", "frontend"], "MIT", 200, 0, 9],
  ["pydantic/pydantic", "Data validation using Python type hints.", "Python", 21100, 1900, ["python", "validation", "json-schema"], "MIT", 90, 0, 9],
  ["BurntSushi/ripgrep", "ripgrep recursively searches directories for a regex pattern while respecting your gitignore.", "Rust", 48200, 1990, ["cli", "search", "grep", "rust"], "Unlicense", 700, 1, 10],
  ["prefix-dev/pixi", "Package management made easy.", "Rust", 4900, 260, ["package-manager", "conda", "cli"], "BSD-3-Clause", 150, 3, 2.3],
  ["oven-sh/bun", "Incredibly fast JavaScript runtime, bundler, test runner, and package manager – all in one.", "Zig", 75400, 2800, ["javascript", "runtime", "bundler", "zig"], "MIT", 400, 0, 4.4],
  ["ggerganov/llama.cpp", "LLM inference in C/C++.", "C++", 71200, 10300, ["llm", "ai", "inference", "ggml"], "MIT", 3, 0, 3.5],
  ["tursodatabase/libsql", "libSQL is a fork of SQLite that is both Open Source, and Open Contributions.", "C", 15300, 380, ["database", "sqlite", "edge"], "MIT", 6, 2, 3.9],
  ["sharkdp/bat", "A cat(1) clone with wings.", "Rust", 50100, 1270, ["cli", "terminal", "syntax-highlighting", "rust"], "Apache-2.0", 1100, 120, 8.4],
  ["eza-community/eza", "A modern alternative to ls.", "Rust", 13500, 280, ["cli", "terminal", "rust"], "MIT", 800, 45, 3.3],
  ["cilium/cilium", "eBPF-based Networking, Security, and Observability.", "Go", 21000, 3100, ["kubernetes", "ebpf", "networking", "security"], "Apache-2.0", 500, 0, 9.5],
  ["derailed/k9s", "Kubernetes CLI To Manage Your Clusters In Style!", "Go", 28900, 1800, ["kubernetes", "cli", "tui"], "Apache-2.0", 650, 4, 7.5],
  ["crossplane/crossplane", "The Cloud Native Control Plane.", "Go", 9800, 990, ["kubernetes", "infrastructure-as-code", "cloud-native"], "Apache-2.0", 420, 1, 7.8],
  ["duckdb/duckdb", "DuckDB is an analytical in-process SQL database management system.", "C++", 27400, 2300, ["database", "sql", "olap", "analytics"], "MIT", 300, 0, 7.2],
  ["drizzle-team/drizzle-orm", "Headless TypeScript ORM with a head.", "TypeScript", 26700, 780, ["orm", "database", "typescript", "postgres"], "Apache-2.0", 260, 0, 3.4],
  ["qdrant/qdrant", "High-performance, massive-scale Vector Database and Vector Search Engine for the next generation of AI.", "Rust", 22500, 1540, ["vector-database", "ai", "search", "database"], "Apache-2.0", 70, 0, 5.3],
  ["langchain-ai/langchain", "Build context-aware reasoning applications.", "Python", 91500, 14800, ["llm", "ai", "agents", "rag"], "MIT", 540, 0, 3.9],
  ["wez/wezterm", "A GPU-accelerated cross-platform terminal emulator and multiplexer.", "Rust", 19800, 890, ["terminal", "gpu", "rust"], "MIT", 610, 200, 7.8],
  ["AstroNvim/AstroNvim", "AstroNvim is an aesthetically pleasing and feature-rich neovim config.", "Lua", 13100, 920, ["neovim", "dotfiles", "lua"], "GPL-3.0", 900, 90, 5.1],
  ["motiondivision/motion", "A modern animation library for React and JavaScript.", "TypeScript", 26800, 870, ["animation", "react", "frontend"], "MIT", 45, 1, 6.2],
  ["lucide-icons/lucide", "Beautiful & consistent icon toolkit made by the community.", "TypeScript", 14200, 740, ["icons", "svg", "frontend"], "ISC", 110, 0, 4.4],
  ["facebookincubator/create-react-kotlin-app", "Create React apps using Kotlin with no build configuration.", "JavaScript", 2480, 150, ["kotlin", "react"], "MIT", 2020, 1800, 8.5, true],
  ["ogham/exa", "A modern replacement for 'ls'.", "Rust", 23410, 660, ["cli", "rust"], "MIT", 2250, 1250, 11, true],
  ["hyperium/tokio-proto", "A generalized protocol framework for Tokio.", "Rust", 640, 90, ["rust", "async", "networking"], "Apache-2.0", 2080, 1900, 9.7],
  ["vercel/hyper", "A terminal built on web technologies.", "TypeScript", 43600, 3500, ["terminal", "electron", "javascript"], "MIT", 2330, 1000, 9.4, true],
];

const COLLECTIONS: (Omit<Collection, "createdAt" | "updatedAt"> & { members: string[] })[] = [
  { id: "ai-ml", name: "AI & Machine Learning", icon: "neurology", description: "LLM engines, inference runtimes, agent frameworks and vector databases.", rules: ["llm", "ai", "inference", "rag", "agents", "vector-database", "deep-learning"], members: ["ollama/ollama", "vllm-project/vllm", "langchain-ai/langchain", "qdrant/qdrant"] },
  { id: "frontend", name: "Frontend Gems", icon: "palette", description: "Modern UI component libraries, animations, CSS toolkits and design systems.", rules: ["react", "css", "tailwindcss", "frontend", "ui", "animation", "icons"], members: ["shadcn-ui/ui", "facebook/react", "tailwindlabs/tailwindcss", "motiondivision/motion", "lucide-icons/lucide"] },
  { id: "rust-cli", name: "Rust CLI & Utilities", icon: "terminal", description: "High performance command-line tools replacing legacy unix utilities.", rules: ["cli", "rust", "terminal"], members: ["astral-sh/uv", "BurntSushi/ripgrep", "sharkdp/bat", "eza-community/eza"] },
  { id: "cloud", name: "Cloud Native & Infra", icon: "cloud", description: "Kubernetes operators, service meshes, eBPF telemetry, declarative infrastructure.", rules: ["kubernetes", "ebpf", "cloud-native", "infrastructure-as-code"], members: ["cilium/cilium", "derailed/k9s", "crossplane/crossplane"] },
  { id: "databases", name: "Database Engines & ORMs", icon: "database", description: "SQLite internals, embedded engines, OLAP and type-safe ORMs.", rules: ["database", "sqlite", "postgres", "orm", "sql"], members: ["duckdb/duckdb", "drizzle-team/drizzle-orm", "tursodatabase/limbo"] },
  { id: "devprod", name: "Developer Productivity", icon: "speed", description: "Terminal emulators, editor configs, linters and runtime tooling.", rules: ["terminal", "neovim", "linter", "formatter", "dotfiles"], members: ["wez/wezterm", "AstroNvim/AstroNvim", "biomejs/biome", "oven-sh/bun"] },
];

const NOTES: Record<string, string> = {
  "astral-sh/uv": "Replaced poetry and pip in all local workflows; saves 45s in CI cold builds.",
  "shadcn-ui/ui": "Foundation for the entire dashboard UI ecosystem. Check radix updates.",
  "ollama/ollama": "Run local embeddings pipeline with mistral-small:8b.",
  "facebook/react": "Tracking React 19 compiler changes & actions architecture.",
  "tursodatabase/limbo": "Exploring for embedded edge database scenarios.",
  "vllm-project/vllm": "Standardized backend across our H100 serving cluster.",
  "biomejs/biome": "Formatting speeds up monorepo checks by ~90%.",
  "supabase/supabase": "Used for primary app auth + real-time presence channels.",
};

const PINNED = ["tailwindlabs/tailwindcss", "astral-sh/uv", "shadcn-ui/ui", "ollama/ollama"];

export function buildDemoData(now = Date.now()) {
  const day = 86_400_000;
  const iso = (daysAgo: number) => new Date(now - daysAgo * day).toISOString();
  const repos: Repo[] = ROWS.map(([fullName, description, language, stars, forks, topics, license, starred, pushed, createdYears, archived], i) => {
    const [owner, name] = fullName.split("/");
    return {
      id: 1000 + i,
      fullName,
      owner,
      name,
      ownerAvatar: `https://github.com/${owner}.png?size=64`,
      description,
      htmlUrl: `https://github.com/${fullName}`,
      homepage: null,
      language,
      topics,
      stars,
      forks,
      watchers: Math.round(stars / 70),
      openIssues: Math.round(forks / 6),
      license,
      archived: archived ?? false,
      fork: false,
      isPrivate: false,
      defaultBranch: "main",
      createdAt: iso(createdYears * 365),
      pushedAt: iso(pushed + (i % 5) / 10),
      starredAt: iso(starred + (i % 7) / 24),
      source: "mock",
    };
  });
  const meta: RepoMeta[] = ROWS.map(([fullName]) => ({
    fullName,
    note: NOTES[fullName] ?? "",
    tags: [],
    pinned: PINNED.includes(fullName),
    updatedAt: iso(0),
  })).filter((m) => m.note || m.pinned);
  const collections: Collection[] = COLLECTIONS.map(({ members: _m, ...c }, i) => ({ ...c, createdAt: iso(300), updatedAt: iso(i * 3) }));
  const items: CollectionItem[] = COLLECTIONS.flatMap((c) => c.members.map((fullName) => ({ collectionId: c.id, fullName, addedAt: iso(20) })));
  return { repos, meta, collections, items };
}

/** Seed the demo vault on first launch so every screen has something to show. */
export async function seedDemoIfEmpty() {
  await db.transaction("rw", [db.repos, db.meta, db.collections, db.items, db.settings], async () => {
    const [repoCount, settings] = await Promise.all([db.repos.count(), db.settings.get("main")]);
    if (repoCount > 0 || settings?.lastSyncedAt) return;
    const data = buildDemoData();
    await db.repos.bulkPut(data.repos);
    await db.meta.bulkPut(data.meta);
    await db.collections.bulkPut(data.collections);
    await db.items.bulkPut(data.items);
  });
}

/** Self-hosted mode never shows the demo vault: drop it so it can't mix with synced data. */
export async function clearDemo() {
  await db.transaction("rw", [db.repos, db.meta, db.collections, db.items, db.outbox], async () => {
    if ((await db.repos.where("source").equals("mock").count()) === 0) return;
    // An outbox next to a demo vault can only hold entries derived from demo data (edits made before the mode was known).
    await Promise.all([db.repos.clear(), db.meta.clear(), db.collections.clear(), db.items.clear(), db.outbox.clear()]);
  });
}
