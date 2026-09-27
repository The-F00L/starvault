/**
 * Read-only access to public GitHub data. No tokens ever live in the browser.
 *
 * Requests go through the StarVault proxy (/api, see server/proxy.ts), which holds a
 * permission-less token for higher rate limits and GraphQL-only data (Lists). When the
 * app is served without the proxy, everything except Lists falls back to calling
 * api.github.com directly (60 requests/hour per visitor).
 */
import { type GhStarredItem, LOGIN, mapStarredItem, nextLink, repoApiPath } from "./github";
import type { Repo } from "./types";

export interface GitHubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  bio: string | null;
  htmlUrl: string;
}

export interface RemoteList {
  id: string;
  name: string;
  description: string | null;
  isPrivate: boolean;
  slug: string;
  createdAt: string;
  updatedAt: string;
  repos: string[];
}

export interface Release {
  id: number;
  tagName: string;
  name: string;
  publishedAt: string;
  htmlUrl: string;
  body: string;
  prerelease: boolean;
}

export interface Contributor {
  login: string;
  avatarUrl: string;
  contributions: number;
  htmlUrl: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const NO_PROXY = Symbol("no-proxy");
let proxyMissing = false;

/** GET a proxy route. Returns NO_PROXY when the site is served without the /api function. */
async function viaProxy<T>(path: string): Promise<T | typeof NO_PROXY> {
  if (proxyMissing) return NO_PROXY;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { headers: { Accept: "application/json" } });
  } catch {
    proxyMissing = true;
    return NO_PROXY;
  }
  // A static host answers unknown paths with index.html (SPA fallback) or a plain 404 page.
  if (!res.headers.get("content-type")?.includes("application/json")) {
    proxyMissing = true;
    return NO_PROXY;
  }
  const body = await res.json();
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

async function direct(path: string, accept = "application/vnd.github+json") {
  const res = await fetch(`https://api.github.com${path}`, { headers: { Accept: accept, "X-GitHub-Api-Version": "2022-11-28" } });
  if (!res.ok) {
    if (res.status === 404) throw new ApiError("Not found on GitHub", 404);
    if (res.status === 403 || res.status === 429) throw new ApiError("GitHub rate limit reached (60 requests/hour without the proxy) — try again later", 429);
    throw new ApiError(`GitHub request failed (${res.status})`, res.status);
  }
  return res;
}

function checkLogin(login: string) {
  if (!LOGIN.test(login)) throw new ApiError(`“${login}” is not a valid GitHub username`, 400);
  return encodeURIComponent(login);
}

export async function fetchUser(login: string): Promise<GitHubUser> {
  const l = checkLogin(login);
  const proxied = await viaProxy<GitHubUser>(`/users/${l}`);
  if (proxied !== NO_PROXY) return proxied;
  const u = await (await direct(`/users/${l}`)).json();
  return { login: u.login, name: u.name, avatarUrl: u.avatar_url, bio: u.bio, htmlUrl: u.html_url };
}

export async function fetchStarred(login: string, onProgress?: (count: number) => void): Promise<Repo[]> {
  const l = checkLogin(login);
  const repos: Repo[] = [];
  for (let page = 1; ; page++) {
    const proxied = await viaProxy<{ items: GhStarredItem[]; hasNext: boolean }>(`/users/${l}/starred?page=${page}`);
    if (proxied === NO_PROXY) break;
    repos.push(...proxied.items.map(mapStarredItem));
    onProgress?.(repos.length);
    if (!proxied.hasNext) return repos;
  }
  // Direct fallback (no proxy available).
  repos.length = 0;
  let url: string | null = `/users/${l}/starred?per_page=100`;
  while (url) {
    const res = await direct(url, "application/vnd.github.star+json");
    repos.push(...((await res.json()) as GhStarredItem[]).map(mapStarredItem));
    onProgress?.(repos.length);
    const next = nextLink(res.headers.get("Link"));
    url = next ? next.replace("https://api.github.com", "") : null;
  }
  return repos;
}

/** Public GitHub star Lists. Only available through the proxy (GraphQL requires a server-side token). */
export async function fetchLists(login: string): Promise<RemoteList[]> {
  const proxied = await viaProxy<RemoteList[]>(`/users/${checkLogin(login)}/lists`);
  if (proxied === NO_PROXY) throw new ApiError("GitHub Lists need the StarVault proxy, which isn't available on this deployment", 501);
  return proxied;
}

export async function fetchReadme(fullName: string): Promise<string | null> {
  const path = repoApiPath(fullName);
  const proxied = await viaProxy<{ markdown: string | null }>(`/repos/${path}/readme`);
  if (proxied !== NO_PROXY) return proxied.markdown;
  try {
    return await (await direct(`/repos/${path}/readme`, "application/vnd.github.raw+json")).text();
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function fetchReleases(fullName: string): Promise<Release[]> {
  const path = repoApiPath(fullName);
  const proxied = await viaProxy<any[]>(`/repos/${path}/releases`);
  const data = proxied !== NO_PROXY ? proxied : await (await direct(`/repos/${path}/releases?per_page=10`)).json();
  return (data as any[]).map((r) => ({
    id: r.id,
    tagName: r.tag_name,
    name: r.name || r.tag_name,
    publishedAt: r.published_at,
    htmlUrl: r.html_url,
    body: r.body ?? "",
    prerelease: r.prerelease,
  }));
}

export async function fetchContributors(fullName: string): Promise<Contributor[]> {
  const path = repoApiPath(fullName);
  const proxied = await viaProxy<any[]>(`/repos/${path}/contributors`);
  let data: any[];
  if (proxied !== NO_PROXY) data = proxied;
  else {
    const res = await direct(`/repos/${path}/contributors?per_page=24`);
    data = res.status === 204 ? [] : await res.json();
  }
  return data.map((c) => ({ login: c.login, avatarUrl: c.avatar_url, contributions: c.contributions, htmlUrl: c.html_url }));
}

/** Reset proxy detection (tests). */
export function __resetProxyDetection() {
  proxyMissing = false;
}
