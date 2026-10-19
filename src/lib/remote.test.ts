import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHandler, loadConfig, type Handler } from "../../server/selfhost";
import { Store } from "../../server/store";
import { StarVaultDB } from "./db";
import { collectionChange, collectionDeleted, itemChange, itemDeleted, metaChange, overrideChange, queue, setOutboxEnabled } from "./outbox";
import { RemoteSync } from "./remote";
import { applyListsSync } from "./sync";
import type { Collection, RepoMeta } from "./types";

// The real server handler and store, reached through an in-process fetch.
let handler: Handler;
let online: boolean;
let beforeReply: (() => Promise<void>) | null;
const newServer = () =>
  createHandler({
    config: loadConfig({ DIST_DIR: "/nonexistent" }),
    store: new Store(":memory:"),
    token: () => ({ ok: true, login: "me", avatarUrl: null }),
    fetch: (() => Promise.reject(new Error("no GitHub in tests"))) as unknown as typeof fetch,
  });
const serverFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (!online) throw new TypeError("Failed to fetch");
  const res = await handler(new Request(new URL(String(input), "http://localhost"), init));
  const hook = beforeReply;
  beforeReply = null;
  await hook?.();
  return res;
}) as typeof fetch;

function device(name = `device-${Math.random()}`) {
  const db = new StarVaultDB(name);
  return { db, remote: new RemoteSync(db, serverFetch) };
}
const stamp = (minutesAgo = 0) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

async function writeNote(db: StarVaultDB, fullName: string, note: string, updatedAt = stamp()) {
  const m: RepoMeta = { fullName, note, tags: [], pinned: false, updatedAt };
  await db.transaction("rw", db.meta, db.outbox, async () => {
    await db.meta.put(m);
    await queue(db, metaChange(m));
  });
}
async function createLocalCollection(db: StarVaultDB, id: string, members: string[]) {
  const t = stamp();
  const c: Collection = { id, name: id, icon: "folder", description: "", rules: [], githubListId: null, createdAt: t, updatedAt: t };
  const items = members.map((fullName) => ({ collectionId: id, fullName, addedAt: t }));
  await db.transaction("rw", db.collections, db.items, db.outbox, async () => {
    await db.collections.put(c);
    await db.items.bulkPut(items);
    await queue(db, collectionChange(c), ...items.map(itemChange));
  });
}
const note = async (db: StarVaultDB, fullName: string) => (await db.meta.get(fullName))?.note;
const state = async (db: StarVaultDB) => db.syncState.get("main");

beforeEach(() => {
  handler = newServer();
  online = true;
  beforeReply = null;
  setOutboxEnabled(true);
});
afterEach(() => setOutboxEnabled(false));

describe("RemoteSync", () => {
  it("makes two devices converge", async () => {
    const a = device();
    const b = device();
    await writeNote(a.db, "x/one", "from A");
    await createLocalCollection(a.db, "c1", ["x/one", "x/two"]);
    await a.remote.sync();
    await b.remote.sync();
    expect(await note(b.db, "x/one")).toBe("from A");
    expect(await b.db.collections.get("c1")).toMatchObject({ name: "c1" });
    expect(await b.db.items.where("collectionId").equals("c1").count()).toBe(2);
    expect(await a.db.outbox.count()).toBe(0);
  });

  it("keeps offline edits and flushes them on reconnect", async () => {
    const a = device();
    const b = device();
    online = false;
    await writeNote(a.db, "x/one", "offline edit");
    await expect(a.remote.sync()).rejects.toMatchObject({ retry: true });
    expect((await state(a.db))?.lastError).toMatch(/unreachable/);
    expect(await a.db.outbox.count()).toBe(1);
    online = true;
    await a.remote.sync();
    expect((await state(a.db))?.lastError).toBeNull();
    await b.remote.sync();
    expect(await note(b.db, "x/one")).toBe("offline edit");
  });

  it("doesn't queue the changes it pulls", async () => {
    const a = device();
    const b = device();
    await writeNote(a.db, "x/one", "hi");
    await a.remote.sync();
    await b.remote.sync();
    expect(await b.db.outbox.count()).toBe(0);
  });

  it("merges both sides on first connection, the newest write winning", async () => {
    const a = device();
    const b = device();
    setOutboxEnabled(false); // written before either device knew about the server
    await writeNote(a.db, "x/shared", "A, older", stamp(10));
    await writeNote(a.db, "x/only-a", "A");
    await writeNote(b.db, "x/shared", "B, newer", stamp(1));
    await writeNote(b.db, "x/only-b", "B");
    setOutboxEnabled(true);
    await a.remote.sync();
    await b.remote.sync();
    await a.remote.sync();
    for (const d of [a, b]) {
      expect(await note(d.db, "x/shared")).toBe("B, newer");
      expect(await note(d.db, "x/only-a")).toBe("A");
      expect(await note(d.db, "x/only-b")).toBe("B");
      expect((await state(d.db))?.firstSyncDone).toBe(true);
    }
  });

  it("propagates deletions", async () => {
    const a = device();
    const b = device();
    await createLocalCollection(a.db, "c1", ["x/one"]);
    await a.remote.sync();
    await b.remote.sync();
    await new Promise((r) => setTimeout(r, 5)); // the delete must be strictly newer than the create
    await b.db.transaction("rw", b.db.collections, b.db.items, b.db.outbox, async () => {
      await b.db.items.where("collectionId").equals("c1").delete();
      await b.db.collections.delete("c1");
      const at = new Date().toISOString();
      await queue(b.db, collectionDeleted("c1", at), itemDeleted("c1", "x/one", at));
    });
    await b.remote.sync();
    await a.remote.sync();
    expect(await a.db.collections.get("c1")).toBeUndefined();
    expect(await a.db.items.count()).toBe(0);
  });

  it("doesn't let a pull overwrite a pending local edit", async () => {
    const a = device();
    const b = device();
    await writeNote(a.db, "x/one", "A");
    await a.remote.sync();
    await writeNote(b.db, "x/one", "B, not pushed yet");
    await b.remote.pull();
    expect(await note(b.db, "x/one")).toBe("B, not pushed yet");
    await b.remote.sync();
    await a.remote.sync();
    expect(await note(a.db, "x/one")).toBe("B, not pushed yet");
  });

  it("applies List overrides once the List is imported on the other device", async () => {
    const a = device();
    const b = device();
    const t = stamp();
    const gh: Collection = { id: "gh:L1", name: "List", icon: "star", description: "", rules: ["cli"], githubListId: "L1", createdAt: t, updatedAt: t };
    await a.db.transaction("rw", a.db.collections, a.db.outbox, async () => {
      await a.db.collections.put(gh);
      await queue(a.db, overrideChange(gh));
    });
    await a.remote.sync();
    await b.remote.sync();
    expect((await state(b.db))?.pendingOverrides).toEqual({ "gh:L1": { icon: "star", rules: ["cli"] } });
    await applyListsSync(b.db, [{ id: "L1", name: "List", description: null, isPrivate: false, slug: "list", createdAt: t, updatedAt: t, repos: [] }]);
    expect(await b.db.collections.get("gh:L1")).toMatchObject({ icon: "star", rules: ["cli"] });
  });

  // Review focus 2
  it("keeps an edit typed while its older version was being pushed", async () => {
    const a = device();
    const b = device();
    await writeNote(a.db, "x/one", "first");
    await a.remote.sync();
    const tick = () => new Promise((r) => setTimeout(r, 5)); // each edit must be strictly newer, or the server keeps the stored one
    await tick();
    await writeNote(a.db, "x/one", "second");
    beforeReply = async () => {
      await tick();
      await writeNote(a.db, "x/one", "third, typed during the push");
    };
    await a.remote.sync();
    expect(await a.db.outbox.count()).toBe(0);
    await b.remote.sync();
    expect(await note(b.db, "x/one")).toBe("third, typed during the push");
    expect(await note(a.db, "x/one")).toBe("third, typed during the push");
  });

  // Review focus 3
  it("sets rejected changes aside and still syncs the rest", async () => {
    const a = device();
    const b = device();
    await writeNote(a.db, "x/good", "fine");
    await writeNote(a.db, "x/skewed", "clock ahead", new Date(Date.now() + 10 * 60_000).toISOString());
    await writeNote(a.db, "x/big", "x".repeat(30_000));
    await a.remote.sync();
    const left = (await a.db.outbox.toArray()).map((e) => [e.key, e.rejected]).sort();
    expect(left).toEqual([
      ["x/big", "NOTE_TOO_LARGE"],
      ["x/skewed", "FUTURE_TIMESTAMP"],
    ]);
    expect((await state(a.db))?.lastError).toBeNull();
    await b.remote.sync();
    expect(await note(b.db, "x/good")).toBe("fine");
    expect(await b.db.meta.count()).toBe(1);
  });

  // Review focus 4
  it("starts over when the server's database was replaced", async () => {
    const a = device();
    const b = device();
    await writeNote(a.db, "x/one", "survives");
    await a.remote.sync();
    handler = newServer(); // empty database: rev 0
    await a.remote.sync();
    await b.remote.sync();
    expect(await note(b.db, "x/one")).toBe("survives");
  });

  it("reads everything back on a pull-only round after the server's database was replaced", async () => {
    const a = device();
    const b = device();
    const c = device();
    await writeNote(b.db, "x/one", "1");
    await writeNote(b.db, "x/two", "2");
    await b.remote.sync(); // b is now at rev 2
    handler = newServer();
    await writeNote(c.db, "x/new", "from the new server");
    await c.remote.sync(); // the new server is at rev 1
    await b.remote.pull();
    expect(await note(b.db, "x/new")).toBe("from the new server");
    // Its own notes go back to the server on the next full round.
    expect((await state(b.db))?.firstSyncDone).toBe(false);
    await b.remote.sync();
    await a.remote.sync();
    expect(await note(a.db, "x/one")).toBe("1");
  });

  // Review focus 5
  it("handles a vault bigger than one batch, one page and one megabyte", async () => {
    const a = device();
    const b = device();
    const t = stamp(1);
    await a.db.meta.bulkPut(
      Array.from({ length: 1200 }, (_, i) => ({ fullName: `x/r${i}`, note: i < 100 ? "n".repeat(15_000) : `note ${i}`, tags: [], pinned: false, updatedAt: t })),
    );
    await a.remote.sync();
    expect(await a.db.outbox.count()).toBe(0);
    await b.remote.sync();
    expect(await b.db.meta.count()).toBe(1200);
  }, 30_000);
});

describe("RemoteSync, follow-ups", () => {
  it.each([
    [403, false], [404, false], [415, false],
    [500, true], [503, true], [429, true],
  ])("retries a %i only if trying again can help", async (status, retry) => {
    const db = new StarVaultDB(`device-${Math.random()}`);
    const replyWith = (async () => new Response(JSON.stringify({ error: "nope" }), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    await writeNote(db, "x/one", "hi");
    await expect(new RemoteSync(db, replyWith).sync()).rejects.toMatchObject({ retry });
  });

  it("notices a replaced database even after another device has pushed past its rev", async () => {
    const a = device();
    const b = device();
    await writeNote(a.db, "x/a", "A's old note");
    await a.remote.sync();
    await b.remote.sync();
    await writeNote(b.db, "x/b", "B's note, never pulled by A");
    await b.remote.sync();
    handler = newServer(); // e.g. restored from an old backup, or a fresh volume
    for (let i = 0; i < 5; i++) await writeNote(a.db, `x/new${i}`, "new");
    await a.remote.sync(); // the new server's rev is now past both devices' last rev
    await b.remote.sync();
    const c = device();
    await c.remote.sync();
    expect(await note(c.db, "x/a")).toBe("A's old note");
    expect(await note(c.db, "x/b")).toBe("B's note, never pulled by A");
  });

  it("doesn't run two tabs' syncs at once", async () => {
    const name = `device-${Math.random()}`;
    const tab1 = device(name);
    const tab2 = device(name);
    let posts = 0;
    const counting = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts++;
        await new Promise((r) => setTimeout(r, 20)); // a slow push: the other tab would read the same outbox meanwhile
      }
      return serverFetch(input, init);
    }) as typeof fetch;
    await writeNote(tab1.db, "x/one", "hi");
    await Promise.all([new RemoteSync(tab1.db, counting).sync(), new RemoteSync(tab2.db, counting).sync()]);
    expect(posts).toBe(1);
  });

  it("drops an item added to a collection another device deleted", async () => {
    const a = device();
    const b = device();
    await createLocalCollection(a.db, "c1", ["x/one"]);
    await a.remote.sync();
    await b.remote.sync();
    await new Promise((r) => setTimeout(r, 5));
    await b.db.transaction("rw", b.db.collections, b.db.items, b.db.outbox, async () => {
      await b.db.items.where("collectionId").equals("c1").delete();
      await b.db.collections.delete("c1");
      const at = new Date().toISOString();
      await queue(b.db, collectionDeleted("c1", at), itemDeleted("c1", "x/one", at));
    });
    await b.remote.sync();
    await new Promise((r) => setTimeout(r, 5));
    const late = { collectionId: "c1", fullName: "x/late", addedAt: new Date().toISOString() };
    await a.db.transaction("rw", a.db.items, a.db.outbox, async () => {
      await a.db.items.put(late);
      await queue(a.db, itemChange(late)); // A hasn't pulled the delete yet
    });
    await a.remote.sync();
    const c = device();
    await c.remote.sync();
    expect(await c.db.items.count()).toBe(0);
    expect(await a.db.items.count()).toBe(0);
    expect(await a.db.collections.count()).toBe(0);
  });
});
