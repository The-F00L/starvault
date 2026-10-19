import { describe, expect, it } from "vitest";
import { __toBase64Url, decodeCollection, encodeCollection } from "./share";
import type { Collection, Repo } from "./types";

const collection: Collection = { id: "c", name: "AI & ML", icon: "neurology", description: "LLM tools", rules: [], createdAt: "", updatedAt: "" };
const repo = (fullName: string, stars = 10): Repo =>
  ({ fullName, description: `about ${fullName}`, language: "Rust", stars }) as Repo;

async function encodeRaw(payload: unknown) {
  const stream = new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return __toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
}

describe("share links", () => {
  it("round-trips a collection", async () => {
    const encoded = await encodeCollection(collection, [repo("ollama/ollama", 98600), repo("astral-sh/uv")]);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodeCollection(encoded)).toEqual({
      name: "AI & ML",
      description: "LLM tools",
      icon: "neurology",
      repos: [
        { fullName: "ollama/ollama", description: "about ollama/ollama", language: "Rust", stars: 98600 },
        { fullName: "astral-sh/uv", description: "about astral-sh/uv", language: "Rust", stars: 10 },
      ],
    });
  });

  it("stays compact for a large collection", async () => {
    const repos = Array.from({ length: 200 }, (_, i) => repo(`owner${i}/repo-${i}`, i));
    expect((await encodeCollection(collection, repos)).length).toBeLessThan(12_000);
  });

  it("rejects garbage", async () => {
    await expect(decodeCollection("")).rejects.toThrow(/malformed/);
    await expect(decodeCollection("not base64!")).rejects.toThrow(/malformed/);
    await expect(decodeCollection("AAAA")).rejects.toThrow(/malformed/);
    await expect(decodeCollection(await encodeRaw({ v: 2, r: [] }))).rejects.toThrow(/malformed/);
  });

  it("sanitises hostile payloads", async () => {
    const decoded = await decodeCollection(
      await encodeRaw({
        v: 1,
        n: "x".repeat(1000),
        i: "bad icon<script>",
        r: [["../../repos/me/r/git/refs", "", "", 1], ["ok/repo", "<img src=x onerror=alert(1)>", 42, -5], "junk", ["a/b", "d", "Go", "1e3"]],
      }),
    );
    expect(decoded.name).toHaveLength(100);
    expect(decoded.icon).toBe("folder_shared");
    expect(decoded.repos).toEqual([
      // Text is kept verbatim (React escapes it on render); types and ranges are enforced.
      { fullName: "ok/repo", description: "<img src=x onerror=alert(1)>", language: null, stars: 0 },
      { fullName: "a/b", description: "d", language: "Go", stars: 1000 },
    ]);
  });
});
