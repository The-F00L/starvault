import type { StarVaultDB } from "./db";
import type { RemoteList } from "./api";
import type { Instance } from "./instance";
import { DEFAULT_LIST_ICON, itemDeleted, queue } from "./outbox";
import type { Collection, Repo } from "./types";

/**
 * A self-hosted instance without a working server token can only read public stars (GitHub's anonymous API).
 * A full star sync would then treat every private star as unstarred and remove it from collections on every
 * device, so refuse it until the token works again.
 */
export function assertStarSyncAllowed(instance: Instance) {
  if (instance.mode === "self-hosted" && !instance.tokenOk) {
    throw new Error("Can't sync stars: the server's GitHub token isn't working. See Settings.");
  }
}

/**
 * Apply a fresh list of starred repos to the vault.
 * - The first real sync replaces all demo data (repos, notes, collections).
 * - Later syncs upsert repos and drop repos (and their collection entries) that are no longer starred;
 *   user notes are kept so re-starring a repo restores them.
 */
export async function applySync(db: StarVaultDB, fetched: Repo[]) {
  await db.transaction("rw", [db.repos, db.meta, db.collections, db.items, db.outbox], async () => {
    const hadDemo = (await db.repos.where("source").equals("mock").count()) > 0;
    if (hadDemo) {
      await Promise.all([db.repos.clear(), db.meta.clear(), db.collections.clear(), db.items.clear()]);
    }
    const keep = new Set(fetched.map((r) => r.fullName));
    const gone = (await db.repos.toCollection().primaryKeys()).filter((k) => !keep.has(k));
    if (gone.length) {
      await db.repos.bulkDelete(gone);
      const dropped = await db.items.where("fullName").anyOf(gone).toArray();
      await db.items.where("fullName").anyOf(gone).delete();
      // Sync removals from the user's own collections so every device agrees (GitHub-List items are re-fetched anyway).
      const local = new Set((await db.collections.toArray()).filter((c) => !c.githubListId).map((c) => c.id));
      await queue(db, ...dropped.filter((i) => local.has(i.collectionId)).map((i) => itemDeleted(i.collectionId, i.fullName)));
    }
    await db.repos.bulkPut(fetched);
  });
}

export async function removeRepo(db: StarVaultDB, fullName: string) {
  await db.transaction("rw", [db.repos, db.items], async () => {
    await db.repos.delete(fullName);
    await db.items.where("fullName").equals(fullName).delete();
  });
}

export const listCollectionId = (listId: string) => `gh:${listId}`;

/**
 * Mirror GitHub star Lists into collections.
 * List-backed collections take name/description/membership from GitHub; local-only fields (icon, rules) survive,
 * and can also come from overrides pulled from the self-hosted server.
 * Lists deleted on GitHub are removed locally. Local-only collections are untouched.
 * Returns how many list items point at repos that aren't in the vault (e.g. unstarred).
 */
export async function applyListsSync(db: StarVaultDB, lists: RemoteList[]): Promise<{ skipped: number }> {
  let skipped = 0;
  await db.transaction("rw", [db.repos, db.collections, db.items, db.syncState], async () => {
    const state = await db.syncState.get("main");
    const pending = { ...state?.pendingOverrides };
    const known = new Set(await db.repos.toCollection().primaryKeys());
    const existing = (await db.collections.toArray()).filter((c) => c.githubListId);
    const remoteIds = new Set(lists.map((l) => l.id));

    for (const c of existing.filter((c) => !remoteIds.has(c.githubListId!))) {
      await db.items.where("collectionId").equals(c.id).delete();
      await db.collections.delete(c.id);
    }

    for (const list of lists) {
      const prev = existing.find((c) => c.githubListId === list.id);
      const id = prev?.id ?? listCollectionId(list.id);
      const override = pending[id];
      delete pending[id];
      const collection: Collection = {
        id,
        name: list.name,
        description: list.description ?? "",
        icon: override?.icon ?? prev?.icon ?? DEFAULT_LIST_ICON,
        rules: override?.rules ?? prev?.rules ?? [],
        githubListId: list.id,
        githubSlug: list.slug,
        isPrivate: list.isPrivate,
        createdAt: list.createdAt,
        updatedAt: list.updatedAt,
      };
      await db.collections.put(collection);
      await db.items.where("collectionId").equals(collection.id).delete();
      const members = list.repos.filter((r) => known.has(r));
      skipped += list.repos.length - members.length;
      await db.items.bulkPut(members.map((fullName) => ({ collectionId: collection.id, fullName, addedAt: list.updatedAt })));
    }
    if (state && Object.keys(pending).length !== Object.keys(state.pendingOverrides).length) {
      await db.syncState.put({ ...state, pendingOverrides: pending });
    }
  });
  return { skipped };
}
