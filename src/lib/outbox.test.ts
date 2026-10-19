import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { itemKey } from "../../server/protocol";
import { assignMany, createCollection, deleteCollection, updateCollection } from "./collections";
import { db, DEFAULT_SYNC_STATE, importVault, updateMeta } from "./db";
import { enqueueAll, EPOCH, setOutboxEnabled } from "./outbox";
import { applyListsSync, applySync } from "./sync";
import type { Collection, Repo } from "./types";

const base: Omit<Repo, "fullName" | "owner" | "name" | "source"> = {
  id: 1, ownerAvatar: "", description: null, htmlUrl: "", homepage: null, language: null, topics: [],
  stars: 0, forks: 0, watchers: 0, openIssues: 0, license: null, archived: false, fork: false,
  isPrivate: false, defaultBranch: "main", createdAt: "2020-01-01", pushedAt: "2020-01-01", starredAt: "2020-01-01",
};
const repo = (fullName: string, source: Repo["source"] = "github"): Repo => {
  const [owner, name] = fullName.split("/");
  return { ...base, fullName, owner, name, source };
};
const T = "2026-10-01T00:00:00.000Z";
const col = (id: string, extra: Partial<Collection> = {}): Collection => ({
  id, name: id, icon: "folder", description: "", rules: [], githubListId: null, createdAt: T, updatedAt: T, ...extra,
});
const ghCol = (listId: string, icon = "format_list_bulleted") => col(`gh:${listId}`, { githubListId: listId, icon });

const entries = () => db.outbox.orderBy("seq").toArray();
const keys = async () => (await entries()).map((e) => `${e.kind}:${e.key}${e.deleted ? " (deleted)" : ""}`);

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  setOutboxEnabled(true);
});
afterEach(() => setOutboxEnabled(false));

describe("public mode", () => {
  it("never writes the outbox", async () => {
    setOutboxEnabled(false);
    await updateMeta("a/b", { note: "x" });
    const c = await createCollection({ name: "C", icon: "folder", description: "" });
    await assignMany([{ collectionId: c.id, fullName: "a/b", member: true }]);
    await updateCollection(c, { name: "D" });
    await deleteCollection(c);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe("write path in self-hosted mode", () => {
  it("queues meta edits, keeping only the newest entry per record", async () => {
    await updateMeta("a/b", { note: "one" });
    await updateMeta("a/b", { note: "two" });
    const all = await entries();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: "meta", key: "a/b", deleted: false, data: { note: "two" } });
    expect(all[0].updatedAt).toBe((all[0].data as { updatedAt: string }).updatedAt);
  });

  it("queues collection create, update, membership and delete", async () => {
    const c = await createCollection({ name: "C", icon: "folder", description: "" });
    await updateCollection(c, { name: "Renamed" });
    await assignMany([
      { collectionId: c.id, fullName: "a/b", member: true },
      { collectionId: c.id, fullName: "a/c", member: true },
    ]);
    await assignMany([{ collectionId: c.id, fullName: "a/c", member: false }]);
    expect(await keys()).toEqual([`collection:${c.id}`, `item:${itemKey(c.id, "a/b")}`, `item:${itemKey(c.id, "a/c")} (deleted)`]);
    expect((await entries())[0].data).toMatchObject({ name: "Renamed" });

    await deleteCollection({ ...c, name: "Renamed" });
    expect(await keys()).toEqual([
      `item:${itemKey(c.id, "a/c")} (deleted)`,
      `collection:${c.id} (deleted)`,
      `item:${itemKey(c.id, "a/b")} (deleted)`,
    ]);
  });

  it("queues only icon and rules for GitHub-List collections", async () => {
    await db.collections.put(ghCol("L1"));
    await updateCollection((await db.collections.get("gh:L1"))!, { icon: "star", rules: ["cli"] });
    expect(await entries()).toMatchObject([{ kind: "listOverride", key: "gh:L1", deleted: false, data: { icon: "star", rules: ["cli"] } }]);
  });

  it("queues removals from local collections when a repo is unstarred, not from GitHub Lists", async () => {
    await db.repos.bulkPut([repo("a/keep"), repo("a/gone")]);
    await db.collections.bulkPut([col("local"), ghCol("L1")]);
    await db.items.bulkPut([
      { collectionId: "local", fullName: "a/gone", addedAt: T },
      { collectionId: "gh:L1", fullName: "a/gone", addedAt: T },
    ]);
    await applySync(db, [repo("a/keep")]);
    expect(await keys()).toEqual([`item:${itemKey("local", "a/gone")} (deleted)`]);
  });

  it("applies pending List overrides when the List arrives, without queueing", async () => {
    await db.syncState.put({ ...DEFAULT_SYNC_STATE, pendingOverrides: { "gh:L1": { icon: "star", rules: ["cli"] } } });
    await applyListsSync(db, [{ id: "L1", name: "List", description: null, isPrivate: false, slug: "list", createdAt: T, updatedAt: T, repos: [] }]);
    expect(await db.collections.get("gh:L1")).toMatchObject({ icon: "star", rules: ["cli"] });
    expect((await db.syncState.get("main"))!.pendingOverrides).toEqual({});
    expect(await db.outbox.count()).toBe(0);
  });
});

describe("enqueueAll", () => {
  it("does nothing while the demo vault is loaded", async () => {
    await db.repos.put(repo("demo/a", "mock"));
    await db.meta.put({ fullName: "demo/a", note: "x", tags: [], pinned: true, updatedAt: T });
    await db.collections.put(col("ai-ml"));
    await enqueueAll(db);
    expect(await db.outbox.count()).toBe(0);
  });

  it("queues notes, local collections with their items, and customised List overrides", async () => {
    await db.meta.put({ fullName: "a/b", note: "x", tags: [], pinned: false, updatedAt: T });
    await db.collections.bulkPut([col("local"), ghCol("L1", "star"), ghCol("L2")]);
    await db.items.bulkPut([
      { collectionId: "local", fullName: "a/b", addedAt: T },
      { collectionId: "gh:L1", fullName: "a/b", addedAt: T },
    ]);
    await enqueueAll(db);
    const all = await entries();
    expect(all.map((e) => `${e.kind}:${e.key}`)).toEqual(["meta:a/b", "collection:local", `item:${itemKey("local", "a/b")}`, "listOverride:gh:L1"]);
    expect(all[0].updatedAt).toBe(T);
    expect(all[3].updatedAt).toBe(EPOCH);
  });

  it("stamps records without a valid timestamp with EPOCH, so any real edit wins", async () => {
    await db.meta.put({ fullName: "a/b", note: "x", tags: [], pinned: false, updatedAt: "" });
    await enqueueAll(db);
    expect((await entries())[0].updatedAt).toBe(EPOCH);
  });

  it("leaves already-queued edits alone", async () => {
    await db.collections.put(ghCol("L1"));
    await updateCollection((await db.collections.get("gh:L1"))!, { icon: "bolt" });
    const [queued] = await entries();
    await enqueueAll(db);
    expect(await entries()).toEqual([queued]);
    expect(queued.updatedAt).not.toBe(EPOCH);
  });
});

describe("importVault in self-hosted mode", () => {
  it("queues the restored records with the current time", async () => {
    const before = new Date().toISOString();
    await importVault({
      version: 1, exportedAt: "", repos: [], collections: [], items: [],
      meta: [{ fullName: "a/b", note: "x", tags: [], pinned: false, updatedAt: "2020-01-01T00:00:00.000Z" }],
    });
    const [e] = await entries();
    expect(e).toMatchObject({ kind: "meta", key: "a/b" });
    expect(e.updatedAt >= before).toBe(true);
  });

  it("queues deletions for records the backup doesn't have, so other devices drop them too", async () => {
    await db.meta.put({ fullName: "gone/meta", note: "", tags: [], pinned: false, updatedAt: T });
    await db.collections.bulkPut([col("gone"), ghCol("L1")]);
    await db.items.put({ collectionId: "gone", fullName: "a/b", addedAt: T });
    await importVault({ version: 1, exportedAt: "", repos: [], meta: [], collections: [], items: [] });
    expect((await keys()).sort()).toEqual(["collection:gone (deleted)", `item:${itemKey("gone", "a/b")} (deleted)`, "meta:gone/meta (deleted)"]);
  });
});
