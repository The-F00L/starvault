/**
 * The only write path for collections.
 * Local collections are fully editable. Collections that mirror a GitHub star List are
 * read-only (StarVault never holds credentials); only their local-only fields — icon and
 * auto-tag rules — can change. Edit the list itself on github.com and re-sync.
 */
import { db } from "./db";
import type { Collection } from "./types";

export class ListReadOnlyError extends Error {
  constructor() {
    super("GitHub Lists are read-only in StarVault — edit this list on github.com, then sync");
  }
}

const now = () => new Date().toISOString();

export async function createCollection(input: Pick<Collection, "name" | "icon" | "description"> & { rules?: string[] }): Promise<Collection> {
  const collection: Collection = {
    id: crypto.randomUUID(),
    name: input.name,
    icon: input.icon,
    description: input.description,
    rules: input.rules ?? [],
    githubListId: null,
    createdAt: now(),
    updatedAt: now(),
  };
  await db.collections.add(collection);
  return collection;
}

export async function updateCollection(c: Collection, patch: Partial<Pick<Collection, "name" | "description" | "icon" | "rules">>) {
  if (c.githubListId && ((patch.name !== undefined && patch.name !== c.name) || (patch.description !== undefined && patch.description !== c.description))) {
    throw new ListReadOnlyError();
  }
  await db.collections.update(c.id, { ...patch, updatedAt: now() });
}

export async function deleteCollection(c: Collection) {
  if (c.githubListId) throw new ListReadOnlyError();
  await db.transaction("rw", db.collections, db.items, async () => {
    await db.items.where("collectionId").equals(c.id).delete();
    await db.collections.delete(c.id);
  });
}

export async function assignMany(changes: { collectionId: string; fullName: string; member: boolean }[]) {
  const cols = new Map((await db.collections.toArray()).map((c) => [c.id, c]));
  if (changes.some((ch) => cols.get(ch.collectionId)?.githubListId)) throw new ListReadOnlyError();
  await db.transaction("rw", db.items, db.collections, async () => {
    for (const ch of changes) {
      if (ch.member) await db.items.put({ collectionId: ch.collectionId, fullName: ch.fullName, addedAt: now() });
      else await db.items.delete([ch.collectionId, ch.fullName]);
      await db.collections.update(ch.collectionId, { updatedAt: now() });
    }
  });
}

export const setMembership = (collectionId: string, fullName: string, member: boolean) => assignMany([{ collectionId, fullName, member }]);

export const githubListUrl = (username: string, c: Collection) =>
  username && c.githubSlug ? `https://github.com/stars/${encodeURIComponent(username)}/lists/${encodeURIComponent(c.githubSlug)}` : null;
