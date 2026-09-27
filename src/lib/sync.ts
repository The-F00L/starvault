import type { StarVaultDB } from "./db";
import type { RemoteList } from "./api";
import type { Collection, Repo } from "./types";

/**
 * Apply a fresh list of starred repos to the vault.
 * - The first real sync replaces all demo data (repos, notes, collections).
 * - Later syncs upsert repos and drop repos (and their collection entries) that are no longer starred;
 *   user notes are kept so re-starring a repo restores them.
 */
export async function applySync(db: StarVaultDB, fetched: Repo[]) {
  await db.transaction("rw", [db.repos, db.meta, db.collections, db.items], async () => {
    const hadDemo = (await db.repos.where("source").equals("mock").count()) > 0;
    if (hadDemo) {
      await Promise.all([db.repos.clear(), db.meta.clear(), db.collections.clear(), db.items.clear()]);
    }
    const keep = new Set(fetched.map((r) => r.fullName));
    const gone = (await db.repos.toCollection().primaryKeys()).filter((k) => !keep.has(k));
    if (gone.length) {
      await db.repos.bulkDelete(gone);
      await db.items.where("fullName").anyOf(gone).delete();
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
 * List-backed collections take name/description/membership from GitHub; local-only fields (icon, rules) survive.
 * Lists deleted on GitHub are removed locally. Local-only collections are untouched.
 * Returns how many list items point at repos that aren't in the vault (e.g. unstarred).
 */
export async function applyListsSync(db: StarVaultDB, lists: RemoteList[]): Promise<{ skipped: number }> {
  let skipped = 0;
  await db.transaction("rw", [db.repos, db.collections, db.items], async () => {
    const known = new Set(await db.repos.toCollection().primaryKeys());
    const existing = (await db.collections.toArray()).filter((c) => c.githubListId);
    const remoteIds = new Set(lists.map((l) => l.id));

    for (const c of existing.filter((c) => !remoteIds.has(c.githubListId!))) {
      await db.items.where("collectionId").equals(c.id).delete();
      await db.collections.delete(c.id);
    }

    for (const list of lists) {
      const id = listCollectionId(list.id);
      const prev = existing.find((c) => c.githubListId === list.id);
      const collection: Collection = {
        id: prev?.id ?? id,
        name: list.name,
        description: list.description ?? "",
        icon: prev?.icon ?? "format_list_bulleted",
        rules: prev?.rules ?? [],
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
  });
  return { skipped };
}
