/**
 * Which deployment serves the app. Public (Cloudflare, or any static host) is the default; a self-hosted
 * server answers GET /api/instance. Decided once at startup, before any data is touched (see startup.ts).
 */
import { configureApi } from "./api";
import { setOutboxEnabled } from "./outbox";

export type Instance =
  | { mode: "public" }
  | { mode: "self-hosted"; login: string | null; avatarUrl: string | null; shareBaseUrl: string | null; tokenOk: boolean; tokenError?: string };

const PUBLIC: Instance = { mode: "public" };
let current: Instance = PUBLIC;
const listeners = new Set<() => void>();
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export async function detectInstance(fetchFn: typeof fetch = (input, init) => fetch(input, init)): Promise<Instance> {
  try {
    const res = await fetchFn("/api/instance", { headers: { Accept: "application/json" } });
    // The public Worker answers unknown /api paths with a JSON 404; static hosts answer with HTML.
    if (!res.ok || !res.headers.get("content-type")?.includes("application/json")) return PUBLIC;
    const b = (await res.json()) as Record<string, unknown> | null;
    if (b?.mode !== "self-hosted") return PUBLIC;
    const share = str(b.shareBaseUrl);
    const tokenError = str(b.tokenError);
    return {
      mode: "self-hosted",
      login: str(b.login),
      avatarUrl: str(b.avatarUrl),
      shareBaseUrl: share && /^https?:\/\//.test(share) ? share : null,
      tokenOk: b.tokenOk === true,
      ...(tokenError ? { tokenError } : {}),
    };
  } catch {
    return PUBLIC;
  }
}

/** Apply the mode: outbox on or off, and which GitHub routes the API client uses. */
export function setInstance(instance: Instance) {
  current = instance;
  setOutboxEnabled(instance.mode === "self-hosted");
  configureApi({
    meLogin: instance.mode === "self-hosted" && instance.tokenOk ? instance.login : null,
    useProxy: instance.mode === "public" || instance.tokenOk,
  });
  listeners.forEach((l) => l());
}

export const getInstance = () => current;

export function subscribeInstance(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Origin for share links. A self-hosted instance points them at the public site, which friends can reach. */
export const shareOrigin = () => (current.mode === "self-hosted" && current.shareBaseUrl) || location.origin;
