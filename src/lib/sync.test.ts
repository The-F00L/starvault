import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { StarVaultDB } from "./db";
import { applyListsSync, applySync, assertStarSyncAllowed } from "./sync";
import type { Repo } from "./types";

const base: Omit<Repo, "fullName" | "owner" | "name" | "source"> = {
  id: 1, ownerAvatar: "", description: null, htmlUrl: "", homepage: null, language: null, topics: [],
  stars: 0, forks: 0, watchers: 0, openIssues: 0, license: null, archived: false, fork: false,
  isPrivate: false, defaultBranch: "main", createdAt: "2020-01-01", pushedAt: "2020-01-01", starredAt: "2020-01-01",
};
const r = (fullName: string, source: Repo["source"] = "github"): Repo => {
  const [owner, name] = fullName.split("/");
  return { ...base, fullName, owner, name, source };
};

let db: StarVaultDB;
beforeEach(async () => {
  db = new StarVaultDB(`test-${Math.random()}`);
  await db.open();
});

describe("assertStarSyncAllowed", () => {
  const selfHosted = { mode: "self-hosted" as const, login: "octo", avatarUrl: null, shareBaseUrl: null };

  it("refuses a self-hosted star sync while the server's token is broken", () => {
    // GitHub's anonymous API would omit private stars, and applySync would drop them from every device's collections.
    expect(() => assertStarSyncAllowed({ ...selfHosted, tokenOk: false, tokenError: "expired" })).toThrow(
      "Can't sync stars: the server's GitHub token isn't working. See Settings.",
    );
  });

  it("allows it otherwise", () => {
    expect(() => assertStarSyncAllowed({ ...selfHosted, tokenOk: true })).not.toThrow();
    expect(() => assertStarSyncAllowed({ mode: "public" })).not.toThrow();
  });
});

describe("applySync", () => {
  it("replaces demo data on the first real sync", async () => {
    await db.repos.bulkPut([r("demo/a", "mock")]);
    await db.meta.put({ fullName: "demo/a", note: "x", tags: [], pinned: true, updatedAt: "" });
    await db.collections.put({ id: "c", name: "C", icon: "", description: "", rules: [], createdAt: "", updatedAt: "" });
    await db.items.put({ collectionId: "c", fullName: "demo/a", addedAt: "" });

    await applySync(db, [r("real/one")]);

    expect(await db.repos.toCollection().primaryKeys()).toEqual(["real/one"]);
    expect(await db.meta.count()).toBe(0);
    expect(await db.collections.count()).toBe(0);
    expect(await db.items.count()).toBe(0);
  });

  it("prunes unstarred repos but keeps user notes and collections", async () => {
    await db.repos.bulkPut([r("a/keep"), r("a/gone")]);
    await db.meta.put({ fullName: "a/gone", note: "remember me", tags: [], pinned: false, updatedAt: "" });
    await db.collections.put({ id: "c", name: "C", icon: "", description: "", rules: [], createdAt: "", updatedAt: "" });
    await db.items.bulkPut([
      { collectionId: "c", fullName: "a/keep", addedAt: "" },
      { collectionId: "c", fullName: "a/gone", addedAt: "" },
    ]);

    await applySync(db, [r("a/keep"), r("a/new")]);

    expect((await db.repos.toCollection().primaryKeys()).sort()).toEqual(["a/keep", "a/new"]);
    expect((await db.items.toArray()).map((i) => i.fullName)).toEqual(["a/keep"]);
    expect((await db.meta.get("a/gone"))?.note).toBe("remember me");
    expect(await db.collections.count()).toBe(1);
  });
});

describe("applyListsSync", () => {
  const list = (id: string, name: string, repos: string[]) => ({
    id, name, repos, description: null, isPrivate: false, slug: name.toLowerCase(), createdAt: "2025-01-01", updatedAt: "2025-02-01",
  });

  it("imports lists as collections with members that are in the vault", async () => {
    await db.repos.bulkPut([r("a/one"), r("a/two")]);
    const { skipped } = await applyListsSync(db, [list("L1", "Tools", ["a/one", "x/not-starred"])]);
    expect(skipped).toBe(1);
    const [c] = await db.collections.toArray();
    expect(c).toMatchObject({ id: "gh:L1", name: "Tools", githubListId: "L1", githubSlug: "tools" });
    expect((await db.items.toArray()).map((i) => i.fullName)).toEqual(["a/one"]);
  });

  it("updates from GitHub, keeps local icon/rules, drops deleted lists, leaves local collections alone", async () => {
    await db.repos.bulkPut([r("a/one"), r("a/two")]);
    await applyListsSync(db, [list("L1", "Tools", ["a/one"]), list("L2", "Gone", ["a/two"])]);
    await db.collections.update("gh:L1", { icon: "bolt", rules: ["cli"] });
    await db.collections.put({ id: "local", name: "Mine", icon: "", description: "", rules: [], createdAt: "", updatedAt: "" });
    await db.items.put({ collectionId: "local", fullName: "a/two", addedAt: "" });

    await applyListsSync(db, [list("L1", "Tooling", ["a/two"])]);

    const cols = await db.collections.orderBy("id").toArray();
    expect(cols.map((c) => c.id)).toEqual(["gh:L1", "local"]);
    expect(cols[0]).toMatchObject({ name: "Tooling", icon: "bolt", rules: ["cli"] });
    const items = await db.items.toArray();
    expect(items.filter((i) => i.collectionId === "gh:L1").map((i) => i.fullName)).toEqual(["a/two"]);
    expect(items.filter((i) => i.collectionId === "local").map((i) => i.fullName)).toEqual(["a/two"]);
  });
});
