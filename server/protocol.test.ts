import { describe, expect, it } from "vitest";
import { itemKey, MAX_BATCH, ProtocolError, splitItemKey, validateChanges, type Change } from "./protocol";

const NOW = Date.parse("2026-10-12T12:00:00.000Z");
const at = "2026-10-12T11:59:00.000Z";
const meta = (note = "hi"): Change => ({
  kind: "meta", key: "a/b", updatedAt: at, deleted: false,
  data: { fullName: "a/b", note, tags: ["x"], pinned: false, updatedAt: at },
});
const collection: Change = {
  kind: "collection", key: "c-1", updatedAt: at, deleted: false,
  data: { id: "c-1", name: "C", icon: "folder", description: "", rules: [], githubListId: null, createdAt: at, updatedAt: at },
};
const item: Change = { kind: "item", key: itemKey("c-1", "a/b"), updatedAt: at, deleted: false, data: { collectionId: "c-1", fullName: "a/b", addedAt: at } };
const override: Change = { kind: "listOverride", key: "gh:UL_kwDOA1", updatedAt: at, deleted: false, data: { icon: "star", rules: ["cli"] } };

function codeOf(body: unknown): [string, number | undefined] {
  try {
    validateChanges(body, NOW);
  } catch (e) {
    if (e instanceof ProtocolError) return [e.code, e.index];
    throw e;
  }
  throw new Error("expected a ProtocolError");
}

describe("item keys", () => {
  it("round-trips collection id and repo name", () => {
    expect(splitItemKey(itemKey("c-1", "a/b"))).toEqual(["c-1", "a/b"]);
    expect(splitItemKey("no-separator")).toBeNull();
  });
});

describe("validateChanges", () => {
  it("accepts one valid change of every kind", () => {
    expect(validateChanges({ changes: [meta(), collection, item, override] }, NOW)).toHaveLength(4);
  });

  it("drops data from deletions", () => {
    const [c] = validateChanges({ changes: [{ ...collection, deleted: true, data: { junk: 1 } }] }, NOW);
    expect(c.data).toBeNull();
  });

  it("rejects malformed bodies and oversized batches", () => {
    expect(codeOf(null)[0]).toBe("BAD_BODY");
    expect(codeOf({ changes: "x" })[0]).toBe("BAD_BODY");
    expect(codeOf({ changes: Array.from({ length: MAX_BATCH + 1 }, () => meta()) })[0]).toBe("BATCH_TOO_LARGE");
  });

  it("reports the code and index of the first bad change", () => {
    expect(codeOf({ changes: [meta(), { ...meta(), kind: "repo" }] })).toEqual(["BAD_KIND", 1]);
    expect(codeOf({ changes: [{ ...meta(), key: "../x" }] })).toEqual(["BAD_KEY", 0]);
    expect(codeOf({ changes: [{ ...item, key: "c-1/a/b" }] })).toEqual(["BAD_KEY", 0]);
    expect(codeOf({ changes: [{ ...collection, key: "gh:L1" }] })).toEqual(["BAD_KEY", 0]);
    expect(codeOf({ changes: [{ ...override, key: "c-1" }] })).toEqual(["BAD_KEY", 0]);
  });

  it("rejects bad and future timestamps", () => {
    expect(codeOf({ changes: [{ ...meta(), updatedAt: "yesterday" }] })[0]).toBe("BAD_TIMESTAMP");
    expect(codeOf({ changes: [{ ...meta(), updatedAt: "2026-10-12T12:06:00.000Z" }] })[0]).toBe("FUTURE_TIMESTAMP");
    expect(validateChanges({ changes: [{ ...meta(), updatedAt: "2026-10-12T12:04:00.000Z" }] }, NOW)).toHaveLength(1);
  });

  it("caps notes at 20 KB and checks record shapes", () => {
    expect(codeOf({ changes: [meta("x".repeat(20_001))] })[0]).toBe("NOTE_TOO_LARGE");
    expect(codeOf({ changes: [{ ...meta(), data: { ...(meta().data as object), fullName: "other/repo" } }] })[0]).toBe("BAD_DATA");
    expect(codeOf({ changes: [{ ...collection, data: { ...(collection.data as object), githubListId: "L1" } }] })[0]).toBe("BAD_DATA");
    expect(codeOf({ changes: [{ ...item, data: { collectionId: "c-2", fullName: "a/b", addedAt: at } }] })[0]).toBe("BAD_DATA");
    expect(codeOf({ changes: [{ ...override, data: { icon: 3, rules: [] } }] })[0]).toBe("BAD_DATA");
  });
});
