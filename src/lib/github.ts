import type { Repo } from "./types";

/* Shapes of the GitHub REST payloads we consume, plus pure helpers. Network access lives in api.ts. */

export interface GhRepo {
  id: number;
  node_id?: string;
  full_name: string;
  name: string;
  owner: { login: string; avatar_url: string };
  description: string | null;
  html_url: string;
  homepage: string | null;
  language: string | null;
  topics?: string[];
  stargazers_count: number;
  forks_count: number;
  subscribers_count?: number;
  watchers_count?: number;
  open_issues_count: number;
  license: { spdx_id: string | null } | null;
  archived: boolean;
  fork: boolean;
  private: boolean;
  default_branch: string;
  created_at: string;
  pushed_at: string;
}

export interface GhStarredItem {
  starred_at: string;
  repo: GhRepo;
}

const SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;
export const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/**
 * Validate and encode an `owner/name` pair for use in an API path.
 * Guards against path traversal (e.g. "../../repos/me/r/git/refs") from tampered backups or share links.
 */
export function repoApiPath(fullName: string): string {
  const parts = fullName.split("/");
  if (parts.length !== 2 || !parts.every((p) => SEGMENT.test(p))) throw new Error(`Invalid repository name: ${fullName}`);
  return parts.map(encodeURIComponent).join("/");
}

export function isValidRepoName(fullName: unknown): fullName is string {
  if (typeof fullName !== "string") return false;
  try {
    repoApiPath(fullName);
    return true;
  } catch {
    return false;
  }
}

export function nextLink(link: string | null): string | null {
  if (!link) return null;
  const match = link.split(",").find((part) => /rel="next"/.test(part));
  return match?.match(/<([^>]+)>/)?.[1] ?? null;
}

export function mapStarredItem({ starred_at, repo }: GhStarredItem): Repo {
  const spdx = repo.license?.spdx_id;
  return {
    id: repo.id,
    nodeId: repo.node_id,
    fullName: repo.full_name,
    owner: repo.owner.login,
    name: repo.name,
    ownerAvatar: repo.owner.avatar_url,
    description: repo.description,
    htmlUrl: repo.html_url,
    homepage: repo.homepage || null,
    language: repo.language,
    topics: repo.topics ?? [],
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    watchers: repo.subscribers_count ?? repo.watchers_count ?? 0,
    openIssues: repo.open_issues_count,
    license: spdx && spdx !== "NOASSERTION" ? spdx : null,
    archived: repo.archived,
    fork: repo.fork,
    isPrivate: repo.private,
    defaultBranch: repo.default_branch,
    createdAt: repo.created_at,
    pushedAt: repo.pushed_at,
    starredAt: starred_at,
    source: "github",
  };
}
