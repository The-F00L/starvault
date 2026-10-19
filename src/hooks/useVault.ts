import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { DEFAULT_SETTINGS, db } from "../lib/db";
import type { Collection, Repo, RepoMeta } from "../lib/types";

const EMPTY: never[] = [];

export function useRepos(): Repo[] | undefined {
  return useLiveQuery(() => db.repos.toArray(), []);
}

export function useMetaMap(): Map<string, RepoMeta> {
  const meta = useLiveQuery(() => db.meta.toArray(), []) ?? EMPTY;
  return useMemo(() => new Map(meta.map((m) => [m.fullName, m])), [meta]);
}

export function useSettings() {
  return useLiveQuery(() => db.settings.get("main"), []) ?? DEFAULT_SETTINGS;
}

export interface CollectionsState {
  collections: Collection[];
  /** collectionId -> member full names */
  members: Map<string, Set<string>>;
  /** fullName -> collection ids */
  membership: Map<string, Set<string>>;
}

export function useCollections(): CollectionsState {
  const collections = useLiveQuery(() => db.collections.orderBy("name").toArray(), []) ?? EMPTY;
  const items = useLiveQuery(() => db.items.toArray(), []) ?? EMPTY;
  return useMemo(() => {
    const members = new Map<string, Set<string>>();
    const membership = new Map<string, Set<string>>();
    for (const c of collections) members.set(c.id, new Set());
    for (const i of items) {
      members.get(i.collectionId)?.add(i.fullName);
      if (!membership.has(i.fullName)) membership.set(i.fullName, new Set());
      membership.get(i.fullName)!.add(i.collectionId);
    }
    return { collections, members, membership };
  }, [collections, items]);
}
