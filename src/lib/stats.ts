import { compactNumber } from "./format";
import type { Collection, Health, Repo, RepoMeta } from "./types";

const DAY = 86_400_000;
const MONTH = 30.44 * DAY;
const YEAR = 365.25 * DAY;

const age = (iso: string, now: number) => now - new Date(iso).getTime();

export function healthOf(repo: Repo, now = Date.now()): Health {
  if (repo.archived) return "archived";
  const sincePush = age(repo.pushedAt, now);
  if (sincePush < 30 * DAY) return "active";
  if (sincePush < 18 * MONTH) return "maintained";
  return "stale";
}

export function healthBreakdown(repos: Repo[], now = Date.now()): Record<Health, number> {
  const out: Record<Health, number> = { active: 0, maintained: 0, stale: 0, archived: 0 };
  for (const r of repos) out[healthOf(r, now)]++;
  return out;
}

/** Starred more than 2 years ago and either archived or without a push for 18+ months. */
export function staleCandidates(repos: Repo[], now = Date.now()): Repo[] {
  return repos.filter(
    (r) => age(r.starredAt, now) > 2 * YEAR && (r.archived || age(r.pushedAt, now) > 18 * MONTH),
  );
}

export function languageCounts(repos: Repo[]): { language: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of repos) if (r.language) counts.set(r.language, (counts.get(r.language) ?? 0) + 1);
  return [...counts].map(([language, count]) => ({ language, count })).sort((a, b) => b.count - a.count);
}

/** Top `n` languages, with everything else (including unknown) folded into "Others". */
export function languageBreakdown(repos: Repo[], n = 5) {
  const counts = languageCounts(repos);
  const top = counts.slice(0, n);
  const others = repos.length - top.reduce((s, c) => s + c.count, 0);
  return others > 0 ? [...top, { language: "Others", count: others }] : top;
}

export function topTopics(repos: Repo[], n = 20): { topic: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of repos) for (const t of r.topics) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
    .slice(0, n);
}

export function starsByMonth(repos: Repo[]): { month: string; count: number }[] {
  if (repos.length === 0) return [];
  const counts = new Map<string, number>();
  for (const r of repos) {
    const m = r.starredAt.slice(0, 7);
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  const months = [...counts.keys()].sort();
  const [fy, fm] = months[0].split("-").map(Number);
  const [ly, lm] = months[months.length - 1].split("-").map(Number);
  const out: { month: string; count: number }[] = [];
  for (let y = fy, m = fm; y < ly || (y === ly && m <= lm); m === 12 ? (y++, (m = 1)) : m++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push({ month: key, count: counts.get(key) ?? 0 });
  }
  return out;
}

export function summary(repos: Repo[], now = Date.now()) {
  const total = repos.length;
  const langs = languageCounts(repos);
  const years = new Map<number, number>();
  for (const r of repos) {
    const y = new Date(r.starredAt).getUTCFullYear();
    years.set(y, (years.get(y) ?? 0) + 1);
  }
  const apex = [...years].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  const maintained = repos.filter((r) => !r.archived && age(r.pushedAt, now) < 6 * MONTH).length;
  return {
    total,
    dominantLanguage: langs[0] ? { language: langs[0].language, share: langs[0].count / total } : null,
    runnerUpLanguage: langs[1] ?? null,
    apexYear: apex ? { year: apex[0], count: apex[1] } : null,
    avgAgeYears: total ? repos.reduce((s, r) => s + age(r.createdAt, now), 0) / total / YEAR : 0,
    maintenanceRatio: total ? maintained / total : 0,
    starredLast30d: repos.filter((r) => age(r.starredAt, now) < 30 * DAY).length,
  };
}

export type SortKey = "starred" | "stars" | "pushed" | "name";

export interface RepoFilter {
  q?: string;
  language?: string | null;
  tags?: string[];
  /** Restrict to these full names (e.g. a collection's members). */
  only?: Set<string> | null;
}

export function filterRepos(repos: Repo[], meta: Map<string, RepoMeta>, f: RepoFilter): Repo[] {
  const q = f.q?.trim().toLowerCase();
  const tags = f.tags ?? [];
  return repos.filter((r) => {
    if (f.only && !f.only.has(r.fullName)) return false;
    if (f.language && r.language !== f.language) return false;
    const m = meta.get(r.fullName);
    if (tags.length) {
      const all = new Set([...r.topics, ...(m?.tags ?? [])]);
      if (!tags.every((t) => all.has(t))) return false;
    }
    if (q) {
      const hay = [r.fullName, r.description ?? "", r.language ?? "", ...r.topics, m?.note ?? "", ...(m?.tags ?? [])]
        .join(" ")
        .toLowerCase();
      if (!q.split(/\s+/).every((word) => hay.includes(word))) return false;
    }
    return true;
  });
}

export function sortRepos(repos: Repo[], key: SortKey): Repo[] {
  const sorted = [...repos];
  switch (key) {
    case "stars":
      return sorted.sort((a, b) => b.stars - a.stars);
    case "pushed":
      return sorted.sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));
    case "name":
      return sorted.sort((a, b) => a.fullName.localeCompare(b.fullName));
    case "starred":
      return sorted.sort((a, b) => b.starredAt.localeCompare(a.starredAt));
  }
}

/** Rank collections by how many of their rules match the repo's topics, language or description. */
export function suggestCollections(repo: Repo, collections: Collection[], limit = 2): Collection[] {
  const topics = new Set(repo.topics.map((t) => t.toLowerCase()));
  const lang = repo.language?.toLowerCase();
  const desc = ` ${(repo.description ?? "").toLowerCase()} `;
  return collections
    .map((c) => ({
      c,
      score: c.rules.reduce((s, rule) => {
        const r = rule.toLowerCase();
        return s + (topics.has(r) || r === lang ? 1 : desc.includes(` ${r} `) ? 0.5 : 0);
      }, 0),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.c);
}

export function collectionMarkdown(collection: Collection, repos: Repo[], now = new Date()): string {
  const lines = [
    `# Awesome ${collection.name} ⭐`,
    "",
    collection.description,
    "",
    `Curated with StarVault. Last synced: ${now.toISOString().slice(0, 10)} • ${repos.length} repositories tracked`,
    "",
    ...[...repos]
      .sort((a, b) => b.stars - a.stars)
      .map((r) => `- [${r.fullName}](${r.htmlUrl})${r.description ? ` - ${r.description}` : ""} ⭐ ${compactNumber(r.stars)}`),
    "",
  ];
  return lines.join("\n");
}
