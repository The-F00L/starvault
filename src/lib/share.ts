/**
 * Share a local collection as a self-contained link: /shared#<payload>.
 * The payload lives in the URL fragment, so it is never sent to any server.
 * Decoding treats it as untrusted input: strict schema, size caps, validated repo names.
 */
import { isValidRepoName } from "./github";
import { shareOrigin } from "./instance";
import type { Collection, Repo } from "./types";

export interface SharedRepo {
  fullName: string;
  description: string | null;
  language: string | null;
  stars: number;
}

export interface SharedCollection {
  name: string;
  description: string;
  icon: string;
  repos: SharedRepo[];
}

const LIMITS = { name: 100, description: 500, repos: 500, repoDescription: 300, language: 40, encoded: 200_000 };
const ICON = /^[a-z_]{1,40}$/;

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

function toBase64Url(bytes: Uint8Array) {
  // Chunked to stay under call-stack argument limits for large payloads.
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(s: string) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

export async function encodeCollection(collection: Collection, repos: Repo[]): Promise<string> {
  const payload = {
    v: 1,
    n: collection.name.slice(0, LIMITS.name),
    d: collection.description.slice(0, LIMITS.description),
    i: collection.icon,
    r: repos.slice(0, LIMITS.repos).map((r) => [r.fullName, (r.description ?? "").slice(0, LIMITS.repoDescription), r.language ?? "", r.stars]),
  };
  return toBase64Url(await pipe(new TextEncoder().encode(JSON.stringify(payload)), new CompressionStream("deflate-raw")));
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export async function decodeCollection(encoded: string): Promise<SharedCollection> {
  if (!encoded || encoded.length > LIMITS.encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error("This share link is malformed");
  let raw: unknown;
  try {
    const bytes = await pipe(fromBase64Url(encoded), new DecompressionStream("deflate-raw"));
    if (bytes.length > 2_000_000) throw new Error();
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("This share link is malformed");
  }
  const p = raw as { v?: unknown; n?: unknown; d?: unknown; i?: unknown; r?: unknown };
  if (p?.v !== 1 || !Array.isArray(p.r)) throw new Error("This share link is malformed");
  const repos: SharedRepo[] = [];
  for (const item of p.r.slice(0, LIMITS.repos)) {
    if (!Array.isArray(item) || !isValidRepoName(item[0])) continue;
    const stars = Number(item[3]);
    repos.push({
      fullName: item[0],
      description: str(item[1], LIMITS.repoDescription) || null,
      language: str(item[2], LIMITS.language) || null,
      stars: Number.isFinite(stars) && stars >= 0 ? Math.floor(stars) : 0,
    });
  }
  return {
    name: str(p.n, LIMITS.name) || "Shared collection",
    description: str(p.d, LIMITS.description),
    icon: typeof p.i === "string" && ICON.test(p.i) ? p.i : "folder_shared",
    repos,
  };
}

export const collectionShareUrl = (encoded: string) => `${shareOrigin()}/shared#${encoded}`;
export const profileShareUrl = (username: string) => `${shareOrigin()}/u/${encodeURIComponent(username)}`;
export { toBase64Url as __toBase64Url };
