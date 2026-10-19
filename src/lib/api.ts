/**
 * Read-only access to public GitHub data. No tokens ever live in the browser.
 *
 * Requests go through the StarVault proxy (/api, see server/proxy.ts), which holds a
 * permission-less token for higher rate limits and GraphQL-only data (Lists). When the
 * app is served without the proxy, everything except Lists falls back to calling
 * api.github.com directly (60 requests/hour per visitor). On a self-hosted server the proxy uses the
 * owner's token and `/api/me/*` adds their private stars and Lists.
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
/** Set while the proxy is protecting its GitHub quota; Lists can't be served then. */
let quotaPausedMessage: string | null = null;

/**
 * Self-hosted with a working token: the instance owner's login. Their own stars and Lists (private included)
 * are read via /api/me/*; anyone else's go through the public /users/<login>/* routes.
 */
let meLogin: string | null = null;
const isMe = (login: string) => meLogin !== null && login.toLowerCase() === meLogin.toLowerCase();

/** Set by instance.ts. Without a working server token, skip the proxy and use GitHub's anonymous API. */
export function configureApi(opts: { meLogin: string | null; useProxy: boolean }) {
  meLogin = opts.meLogin;
  proxyMissing = !opts.useProxy;
}

/**
 * The owner's own stars have no safe fallback: GitHub's anonymous API omits private stars, so a fallback
 * result would make them look unstarred and "Sync stars" would strip them from collections on every device.
 */
async function ownStars(path: string) {
  const fail = () => new ApiError("StarVault couldn't read your stars from this server. Try again in a moment.", 503);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { headers: { Accept: "application/json" } });
  } catch {
    throw fail();
  }
  if (!res.headers.get("content-type")?.includes("application/json")) throw fail();
  const body = await res.json();
  if (res.status === 503 && body.code === "QUOTA_RESERVE") throw fail();
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
  return body as { items: GhStarredItem[]; hasNext: boolean };
}

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
  // The proxy stops spending its token near the hourly limit. Fall back to direct (anonymous)
  // calls for this request so the visitor's own 60/hour allowance is used instead.
  if (res.status === 503 && body.code === "QUOTA_RESERVE") {
    quotaPausedMessage = body.error;
    return NO_PROXY;
  }
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
    const proxied = isMe(login)
      ? await ownStars(`/me/starred?page=${page}`)
      : await viaProxy<{ items: GhStarredItem[]; hasNext: boolean }>(`/users/${l}/starred?page=${page}`);
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
  const l = checkLogin(login);
  const proxied = await viaProxy<RemoteList[]>(isMe(login) ? "/me/lists" : `/users/${l}/lists`);
  if (proxied === NO_PROXY) {
    throw quotaPausedMessage
      ? new ApiError(`${quotaPausedMessage}. Lists will be back after that.`, 503)
      : new ApiError("GitHub Lists need the StarVault proxy, which isn't available on this deployment", 501);
  }
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
  quotaPausedMessage = null;
  meLogin = null;
}
