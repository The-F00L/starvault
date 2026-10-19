import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", async (orig) => {
  const mod = await orig<typeof import("./db")>();
  return { ...mod, db: new mod.StarVaultDB(`test-${Math.random()}`) };
});

const { db } = await import("./db");
const { createCollection, deleteCollection, ListReadOnlyError, setMembership, updateCollection } = await import("./collections");

const gh = { id: "gh:L1", name: "List", icon: "", description: "", rules: [], githubListId: "L1", createdAt: "", updatedAt: "" };

beforeEach(async () => {
  await Promise.all([db.collections.clear(), db.items.clear()]);
});

describe("collections service", () => {
  it("fully edits local collections", async () => {
    const c = await createCollection({ name: "Local", icon: "x", description: "" });
    await setMembership(c.id, "a/one", true);
    await updateCollection(c, { name: "Renamed", rules: ["cli"] });
    expect(await db.items.count()).toBe(1);
    expect(await db.collections.get(c.id)).toMatchObject({ name: "Renamed", rules: ["cli"] });
    await deleteCollection({ ...c, name: "Renamed" });
    expect(await db.collections.count()).toBe(0);
    expect(await db.items.count()).toBe(0);
  });

  it("keeps GitHub List collections read-only except local-only fields", async () => {
    await db.collections.put(gh);
    await expect(setMembership("gh:L1", "a/one", true)).rejects.toBeInstanceOf(ListReadOnlyError);
    await expect(updateCollection(gh, { name: "Other" })).rejects.toBeInstanceOf(ListReadOnlyError);
    await expect(deleteCollection(gh)).rejects.toBeInstanceOf(ListReadOnlyError);
    await updateCollection(gh, { icon: "bolt", rules: ["ai"], name: "List" });
    expect(await db.collections.get("gh:L1")).toMatchObject({ icon: "bolt", rules: ["ai"], name: "List" });
    expect(await db.items.count()).toBe(0);
  });
});
