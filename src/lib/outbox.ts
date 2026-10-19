/**
 * Outbox of local changes for the self-hosted server. Every user write calls `queue` inside the same
 * Dexie transaction as the write, so a change can't be saved locally but forgotten for sync.
 * Disabled (a no-op) on the public site.
 */
import { ISO_TIMESTAMP, itemKey, type Change } from "../../server/protocol";
import type { StarVaultDB } from "./db";
import type { Collection, CollectionItem, RepoMeta } from "./types";

let enabled = false;

/** Turned on by instance.ts once the app knows it runs self-hosted. */
export function setOutboxEnabled(on: boolean) {
  enabled = on;
}
export const outboxEnabled = () => enabled;

/** Timestamp for records that have no usable one: loses to any real edit. */
export const EPOCH = "1970-01-01T00:00:00.000Z";
export const DEFAULT_LIST_ICON = "format_list_bulleted";

const now = () => new Date().toISOString();
const stamp = (s: string | undefined) => (s && ISO_TIMESTAMP.test(s) ? s : EPOCH);

export const metaChange = (m: RepoMeta): Change => ({ kind: "meta", key: m.fullName, data: m, updatedAt: stamp(m.updatedAt), deleted: false });
export const metaDeleted = (fullName: string, at = now()): Change => ({ kind: "meta", key: fullName, data: null, updatedAt: at, deleted: true });
export const collectionChange = (c: Collection): Change => ({ kind: "collection", key: c.id, data: c, updatedAt: stamp(c.updatedAt), deleted: false });
export const collectionDeleted = (id: string, at = now()): Change => ({ kind: "collection", key: id, data: null, updatedAt: at, deleted: true });
export const itemChange = (i: CollectionItem): Change => ({
  kind: "item", key: itemKey(i.collectionId, i.fullName), data: i, updatedAt: stamp(i.addedAt), deleted: false,
});
export const itemDeleted = (collectionId: string, fullName: string, at = now()): Change => ({
  kind: "item", key: itemKey(collectionId, fullName), data: null, updatedAt: at, deleted: true,
});
export const overrideChange = (c: Collection, at = now()): Change => ({
  kind: "listOverride", key: c.id, data: { icon: c.icon, rules: c.rules }, updatedAt: at, deleted: false,
});

/** Record changes for the server, replacing any older pending entry for the same record. Call inside the write's transaction. */
export async function queue(db: StarVaultDB, ...changes: Change[]) {
  if (!enabled) return;
  for (const c of changes) {
    await db.outbox.where("[kind+key]").equals([c.kind, c.key]).delete();
    await db.outbox.add({ ...c });
  }
}

/**
 * Queue every user-written record: on first connection to a server (with each record's own timestamp, so
 * last-write-wins merges both sides), or after restoring a backup (`at` = now, so the restore wins).
 * Does nothing while the demo vault is loaded, so demo data never reaches the server.
 */
export async function enqueueAll(db: StarVaultDB, at?: string) {
  await db.transaction("rw", [db.repos, db.meta, db.collections, db.items, db.outbox], async () => {
    if ((await db.repos.where("source").equals("mock").count()) > 0) return;
    const [meta, collections, items, queued] = await Promise.all([db.meta.toArray(), db.collections.toArray(), db.items.toArray(), db.outbox.toArray()]);
    const pending = new Set(queued.map((e) => `${e.kind}|${e.key}`));
    const local = new Set(collections.filter((c) => !c.githubListId).map((c) => c.id));
    const changes = [
      ...meta.map(metaChange),
      ...collections.filter((c) => local.has(c.id)).map(collectionChange),
      ...items.filter((i) => local.has(i.collectionId)).map(itemChange),
      // Overrides carry no edit time of their own: EPOCH lets any override already on the server win.
      ...collections.filter((c) => c.githubListId && (c.icon !== DEFAULT_LIST_ICON || c.rules.length > 0)).map((c) => overrideChange(c, EPOCH)),
    ];
    // Pending entries are real edits with real timestamps; don't downgrade them (except on restore, which wins outright).
    await queue(db, ...(at ? changes.map((c) => ({ ...c, updatedAt: at })) : changes.filter((c) => !pending.has(`${c.kind}|${c.key}`))));
  });
}
