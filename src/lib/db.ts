import Dexie, { type EntityTable } from "dexie";
import { itemKey } from "../../server/protocol";
import { isValidRepoName } from "./github";
import { collectionDeleted, enqueueAll, itemDeleted, metaChange, metaDeleted, outboxEnabled, queue } from "./outbox";
import type { Collection, CollectionItem, OutboxEntry, Repo, RepoMeta, Settings, SyncState } from "./types";

export class StarVaultDB extends Dexie {
  repos!: EntityTable<Repo, "fullName">;
  meta!: EntityTable<RepoMeta, "fullName">;
  collections!: EntityTable<Collection, "id">;
  items!: Dexie.Table<CollectionItem, [string, string]>;
  settings!: EntityTable<Settings, "key">;
  outbox!: EntityTable<OutboxEntry, "seq">;
  syncState!: EntityTable<SyncState, "key">;

  constructor(name = "starvault") {
    super(name);
    this.version(1).stores({
      repos: "fullName, id, language, starredAt, pushedAt, stars, *topics, source",
      meta: "fullName, pinned, *tags",
      collections: "id, name",
      items: "[collectionId+fullName], collectionId, fullName",
      settings: "key",
    });
    // v2: StarVault no longer accepts GitHub tokens; scrub any stored by earlier builds.
    this.version(2).upgrade((tx) =>
      tx
        .table("settings")
        .toCollection()
        .modify((s: Record<string, unknown>) => {
          delete s.token;
          delete s.scopes;
        }),
    );
    // v3: self-hosted sync. Both tables stay empty on the public site.
    this.version(3).stores({ outbox: "++seq, [kind+key]", syncState: "key" });
  }
}

export const db = new StarVaultDB();

export const DEFAULT_SETTINGS: Settings = {
  key: "main",
  username: "",
  lastSyncedAt: null,
  avatarUrl: null,
};

export const DEFAULT_SYNC_STATE: SyncState = {
  key: "main",
  rev: 0,
  lastPullAt: null,
  lastPushAt: null,
  lastError: null,
  firstSyncDone: false,
  serverId: null,
  pendingOverrides: {},
};

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get("main")) ?? DEFAULT_SETTINGS;
}

export async function saveSettings(patch: Partial<Settings>) {
  const current = await getSettings();
  await db.settings.put({ ...current, ...patch, key: "main" });
}

export function emptyMeta(fullName: string): RepoMeta {
  return { fullName, note: "", tags: [], pinned: false, updatedAt: new Date().toISOString() };
}

export async function updateMeta(fullName: string, patch: Partial<Omit<RepoMeta, "fullName">>) {
  await db.transaction("rw", db.meta, db.outbox, async () => {
    const current = (await db.meta.get(fullName)) ?? emptyMeta(fullName);
    const next = { ...current, ...patch, fullName, updatedAt: new Date().toISOString() };
    await db.meta.put(next);
    await queue(db, metaChange(next));
  });
}

/** Full user-data backup (repos are re-syncable, but included so demo/offline state round-trips). */
export async function exportVault() {
  const [repos, meta, collections, items] = await Promise.all([
    db.repos.toArray(),
    db.meta.toArray(),
    db.collections.toArray(),
    db.items.toArray(),
  ]);
  return { version: 1, exportedAt: new Date().toISOString(), repos, meta, collections, items };
}

export async function importVault(data: Awaited<ReturnType<typeof exportVault>>) {
  if (data?.version !== 1) throw new Error("Unsupported backup format");
  if (![data.repos, data.meta, data.collections, data.items].every(Array.isArray)) throw new Error("Malformed backup");
  const bad = [...data.repos.map((r) => r.fullName), ...data.meta.map((m) => m.fullName), ...data.items.map((i) => i.fullName)].find(
    (n) => typeof n !== "string" || !isValidRepoName(n),
  );
  if (bad !== undefined) throw new Error(`Backup contains an invalid repository name: ${String(bad).slice(0, 80)}`);
  await db.transaction("rw", [db.repos, db.meta, db.collections, db.items, db.outbox], async () => {
    // Self-hosted: other devices must drop what the backup doesn't have. A demo backup never reaches the server.
    const at = new Date().toISOString();
    const send = outboxEnabled() && !data.repos.some((r) => r.source === "mock");
    if (send) await queue(db, ...(await deletionsForRestore(data, at)));
    await Promise.all([db.repos.clear(), db.meta.clear(), db.collections.clear(), db.items.clear()]);
    await db.repos.bulkPut(data.repos);
    await db.meta.bulkPut(data.meta);
    await db.collections.bulkPut(data.collections);
    await db.items.bulkPut(data.items);
    // And send the restored state, or other devices would never see it.
    if (send) await enqueueAll(db, at);
  });
}

/** Tombstones for the synced records here now that the backup lacks. */
async function deletionsForRestore(data: Awaited<ReturnType<typeof exportVault>>, at: string) {
  const keep = {
    meta: new Set(data.meta.map((m) => m.fullName)),
    collections: new Set(data.collections.map((c) => c.id)),
    items: new Set(data.items.map((i) => itemKey(i.collectionId, i.fullName))),
  };
  const [meta, collections, items] = await Promise.all([db.meta.toArray(), db.collections.toArray(), db.items.toArray()]);
  const local = new Set(collections.filter((c) => !c.githubListId).map((c) => c.id));
  return [
    ...meta.filter((m) => !keep.meta.has(m.fullName)).map((m) => metaDeleted(m.fullName, at)),
    ...[...local].filter((id) => !keep.collections.has(id)).map((id) => collectionDeleted(id, at)),
    ...items
      .filter((i) => local.has(i.collectionId) && !keep.items.has(itemKey(i.collectionId, i.fullName)))
      .map((i) => itemDeleted(i.collectionId, i.fullName, at)),
  ];
}
