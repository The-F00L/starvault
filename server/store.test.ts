import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Change } from "./protocol";
import { Store } from "./store";

const change = (key: string, updatedAt: string, note = key, deleted = false): Change => ({
  kind: "meta", key, updatedAt, deleted,
  data: deleted ? null : { fullName: key, note, tags: [], pinned: false, updatedAt },
});
const T1 = "2026-10-12T10:00:00.000Z";
const T2 = "2026-10-12T11:00:00.000Z";

let store: Store;
beforeEach(() => {
  store = new Store(":memory:");
});
afterEach(() => store.close());

describe("Store.push", () => {
  it("inserts new records and returns them with a rev", () => {
    const [stored] = store.push([change("a/b", T1)]);
    expect(stored).toMatchObject({ kind: "meta", key: "a/b", updatedAt: T1, deleted: false, rev: 1 });
    expect(stored.data).toMatchObject({ note: "a/b" });
  });

  it("lets the newer write win and returns the winner for older writes", () => {
    store.push([change("a/b", T2, "new")]);
    const [result] = store.push([change("a/b", T1, "old")]);
    expect(result).toMatchObject({ updatedAt: T2, data: { note: "new" } });
    store.push([change("a/b", "2026-10-12T12:00:00.000Z", "newest")]);
    expect(store.pull(0).changes[0].data).toMatchObject({ note: "newest" });
  });

  it("keeps the stored row on a timestamp tie", () => {
    store.push([change("a/b", T1, "first")]);
    const [result] = store.push([change("a/b", T1, "second")]);
    expect(result.data).toMatchObject({ note: "first" });
  });

  it("stores tombstones without data", () => {
    store.push([change("a/b", T1)]);
    const [result] = store.push([change("a/b", T2, "", true)]);
    expect(result).toMatchObject({ deleted: true, data: null });
  });

  it("gives every accepted change a new, higher rev, across calls", () => {
    store.push([change("a/1", T1), change("a/2", T1)]);
    const [again] = store.push([change("a/1", T2)]);
    expect(again.rev).toBe(3);
    const [rejected] = store.push([change("a/2", T1, "tie")]);
    expect(rejected.rev).toBe(2);
  });
});

describe("Store.pull", () => {
  it("returns changes after `since` in rev order", () => {
    store.push([change("a/1", T1), change("a/2", T1), change("a/3", T1)]);
    const page = store.pull(1);
    expect(page.changes.map((c) => c.key)).toEqual(["a/2", "a/3"]);
    expect(page).toMatchObject({ rev: 3, more: false });
  });

  it("pages with `more`", () => {
    store.push(Array.from({ length: 5 }, (_, i) => change(`a/${i}`, T1)));
    const first = store.pull(0, 2);
    expect(first).toMatchObject({ rev: 2, more: true });
    const last = store.pull(4, 2);
    expect(last).toMatchObject({ rev: 5, more: false });
  });

  it("reports the current rev when nothing is new, so clients can spot a reset", () => {
    store.push([change("a/1", T1)]);
    expect(store.pull(1)).toEqual({ changes: [], rev: 1, more: false, serverId: store.serverId });
    expect(store.pull(50)).toEqual({ changes: [], rev: 1, more: false, serverId: store.serverId });
    expect(new Store(":memory:").pull(7).rev).toBe(0);
  });
});

describe("Store, follow-ups", () => {
  it("has a stable id per database file, sent with every pull", () => {
    const id = store.pull(0).serverId;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(store.pull(0).serverId).toBe(id);
    const other = new Store(":memory:");
    expect(other.pull(0).serverId).not.toBe(id);
    other.close();
  });

  it("stores an item for a deleted collection as deleted", () => {
    const sep = "\u001f";
    store.push([{ kind: "collection", key: "c1", data: null, updatedAt: T1, deleted: true }]);
    const [r] = store.push([{ kind: "item", key: `c1${sep}a/b`, data: { collectionId: "c1", fullName: "a/b", addedAt: T2 }, updatedAt: T2, deleted: false }]);
    expect(r).toMatchObject({ deleted: true, data: null, updatedAt: T2 });
  });
});
