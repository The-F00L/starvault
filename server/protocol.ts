/**
 * Sync protocol shared by the self-hosted server (server/selfhost.ts) and the browser (src/lib/remote.ts).
 * Only data the user writes syncs; GitHub-derived data is re-fetched by each device.
 */

export const KINDS = ["meta", "collection", "item", "listOverride"] as const;
export type Kind = (typeof KINDS)[number];

export interface Change {
  kind: Kind;
  /** meta: `owner/repo`; collection: its id; item: itemKey(); listOverride: `gh:<listId>`. */
  key: string;
  /** The record as stored in IndexedDB; null for a deletion. */
  data: unknown;
  /** Date#toISOString() from the writing device. The newer write wins. */
  updatedAt: string;
  deleted: boolean;
}

export interface StoredChange extends Change {
  /** Server sequence number; increases on every accepted change. */
  rev: number;
}

export interface PullPage {
  changes: StoredChange[];
  /** The last rev in `changes`, or the server's current rev when there are none. */
  rev: number;
  more: boolean;
  /** Random id of the server's database. A new id means it was replaced, so clients start over. */
  serverId: string;
}

export const MAX_BATCH = 500;
export const MAX_BODY_BYTES = 1_000_000;
export const MAX_NOTE_BYTES = 20_000;
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;
export const PULL_PAGE = 1000;
/** Not NUL: node:sqlite truncates text at a NUL byte, which collapsed every item key to its collection id. */
export const ITEM_SEP = "\u001f";
/** Exactly what Date#toISOString() produces, so timestamps compare correctly as strings. */
export const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;
const COLLECTION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const LIST_COLLECTION_ID = /^gh:[A-Za-z0-9_=-]{1,128}$/;

export const itemKey = (collectionId: string, fullName: string) => `${collectionId}${ITEM_SEP}${fullName}`;

export function splitItemKey(key: string): [string, string] | null {
  const i = key.indexOf(ITEM_SEP);
  return i < 0 ? null : [key.slice(0, i), key.slice(i + 1)];
}

export class ProtocolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly index?: number,
  ) {
    super(message);
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isRepoName = (s: string) => {
  const parts = s.split("/");
  return parts.length === 2 && parts.every((p) => SEGMENT.test(p));
};
const str = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
const strs = (v: unknown, maxCount: number, maxLen: number) => Array.isArray(v) && v.length <= maxCount && v.every((s) => str(s, maxLen));

function keyIsValid(kind: Kind, key: string): boolean {
  switch (kind) {
    case "meta":
      return isRepoName(key);
    case "collection":
      return COLLECTION_ID.test(key);
    case "item": {
      const parts = splitItemKey(key);
      return !!parts && COLLECTION_ID.test(parts[0]) && isRepoName(parts[1]);
    }
    case "listOverride":
      return LIST_COLLECTION_ID.test(key);
  }
}

function checkData(kind: Kind, key: string, d: unknown): [string, string] | null {
  const bad: [string, string] = ["BAD_DATA", `Malformed ${kind} record`];
  if (!isObject(d)) return bad;
  switch (kind) {
    case "meta":
      if (d.fullName !== key || typeof d.note !== "string" || !strs(d.tags, 100, 100) || typeof d.pinned !== "boolean") return bad;
      if (d.keep !== undefined && typeof d.keep !== "boolean") return bad;
      if (new TextEncoder().encode(d.note).length > MAX_NOTE_BYTES) return ["NOTE_TOO_LARGE", "Notes are limited to 20 KB"];
      return null;
    case "collection":
      if (d.id !== key || !str(d.name, 200) || !str(d.icon, 64) || !str(d.description, 2000) || !strs(d.rules, 100, 100)) return bad;
      if (d.githubListId !== undefined && d.githubListId !== null) return bad; // GitHub-List collections never sync
      return typeof d.createdAt === "string" && typeof d.updatedAt === "string" ? null : bad;
    case "item": {
      const [collectionId, fullName] = splitItemKey(key)!;
      return d.collectionId === collectionId && d.fullName === fullName && typeof d.addedAt === "string" ? null : bad;
    }
    case "listOverride":
      return str(d.icon, 64) && strs(d.rules, 100, 100) ? null : bad;
  }
}

function checkChange(c: unknown, now: number): [string, string] | null {
  if (!isObject(c)) return ["BAD_CHANGE", "Each change must be an object"];
  const { kind, key, data, updatedAt, deleted } = c;
  if (!KINDS.includes(kind as Kind)) return ["BAD_KIND", `Unknown kind: ${String(kind).slice(0, 40)}`];
  if (typeof key !== "string" || !keyIsValid(kind as Kind, key)) return ["BAD_KEY", `Invalid ${String(kind)} key`];
  if (typeof updatedAt !== "string" || !ISO_TIMESTAMP.test(updatedAt) || Number.isNaN(Date.parse(updatedAt))) {
    return ["BAD_TIMESTAMP", "updatedAt must be an ISO timestamp"];
  }
  if (Date.parse(updatedAt) > now + MAX_CLOCK_SKEW_MS) return ["FUTURE_TIMESTAMP", "updatedAt is more than 5 minutes in the future"];
  if (typeof deleted !== "boolean") return ["BAD_CHANGE", "deleted must be true or false"];
  return deleted ? null : checkData(kind as Kind, key, data);
}

/** Validate a POST /api/sync body. A batch is accepted or rejected as a whole. */
export function validateChanges(body: unknown, now = Date.now()): Change[] {
  const changes = isObject(body) ? body.changes : undefined;
  if (!Array.isArray(changes)) throw new ProtocolError("BAD_BODY", "Expected { changes: [...] }");
  if (changes.length > MAX_BATCH) throw new ProtocolError("BATCH_TOO_LARGE", `At most ${MAX_BATCH} changes per request`);
  return changes.map((c, i) => {
    const problem = checkChange(c, now);
    if (problem) throw new ProtocolError(problem[0], problem[1], i);
    const { kind, key, data, updatedAt, deleted } = c as Change;
    return { kind, key, data: deleted ? null : data, updatedAt, deleted };
  });
}
