import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetProxyDetection, fetchLists, fetchStarred } from "./api";
import { detectInstance, getInstance, setInstance, shareOrigin } from "./instance";
import { outboxEnabled } from "./outbox";
import { collectionShareUrl } from "./share";

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const selfHosted = { mode: "self-hosted" as const, login: "octo", avatarUrl: "a", shareBaseUrl: "https://sv.example.workers.dev", tokenOk: true };
const fetchReturning = (reply: () => Promise<Response>) => vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => reply());

afterEach(() => {
  setInstance({ mode: "public" });
  __resetProxyDetection();
  vi.unstubAllGlobals();
});

describe("detectInstance", () => {
  it("recognises a self-hosted server", async () => {
    const f = fetchReturning(async () => jsonRes({ ...selfHosted, unknownField: 1 }));
    expect(await detectInstance(f as unknown as typeof fetch)).toEqual(selfHosted);
    expect(f.mock.calls[0][0]).toBe("/api/instance");
  });

  it("falls back to public for anything else", async () => {
    for (const reply of [
      async () => new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } }),
      async () => jsonRes({ error: "Not found" }, 404),
      async () => jsonRes({ mode: "something-else" }),
      async () => {
        throw new TypeError("offline");
      },
    ]) {
      expect(await detectInstance(fetchReturning(reply) as unknown as typeof fetch)).toEqual({ mode: "public" });
    }
  });

  it("ignores a share base URL that isn't http(s)", async () => {
    const i = await detectInstance(fetchReturning(async () => jsonRes({ ...selfHosted, shareBaseUrl: "javascript:alert(1)" })) as unknown as typeof fetch);
    expect(i).toMatchObject({ mode: "self-hosted", shareBaseUrl: null });
  });
});

describe("setInstance", () => {
  it("turns on the outbox and the /api/me routes when self-hosted", async () => {
    setInstance(selfHosted);
    expect(outboxEnabled()).toBe(true);
    const f = fetchReturning(async () => jsonRes({ items: [], hasNext: false }));
    vi.stubGlobal("fetch", f);
    await fetchStarred("octo");
    expect(f.mock.calls[0][0]).toBe("/api/me/starred?page=1");
    f.mockImplementation(async () => jsonRes([]));
    await fetchLists("octo");
    expect(f.mock.calls[1][0]).toBe("/api/me/lists");
  });

  it("reads other people's profiles from their public routes, not the owner's /api/me", async () => {
    setInstance(selfHosted);
    const f = fetchReturning(async () => jsonRes({ items: [], hasNext: false }));
    vi.stubGlobal("fetch", f);
    await fetchStarred("torvalds");
    expect(f.mock.calls[0][0]).toBe("/api/users/torvalds/starred?page=1");
    await fetchStarred("OCTO"); // GitHub logins are case-insensitive
    expect(f.mock.calls[1][0]).toBe("/api/me/starred?page=1");
    f.mockImplementation(async () => jsonRes([]));
    await fetchLists("torvalds");
    expect(f.mock.calls[2][0]).toBe("/api/users/torvalds/lists");
  });

  it("calls GitHub directly when the server's token is broken", async () => {
    setInstance({ ...selfHosted, tokenOk: false, tokenError: "expired" });
    const f = fetchReturning(async () => jsonRes([]));
    vi.stubGlobal("fetch", f);
    await fetchStarred("octo");
    expect(String(f.mock.calls[0][0])).toMatch(/^https:\/\/api\.github\.com\/users\/octo\/starred/);
  });

  it("goes back to public behaviour", () => {
    setInstance(selfHosted);
    setInstance({ mode: "public" });
    expect(outboxEnabled()).toBe(false);
    expect(getInstance()).toEqual({ mode: "public" });
  });
});

describe("share links", () => {
  it("point at the public site when self-hosted", () => {
    vi.stubGlobal("location", { origin: "https://homelab.tail1234.ts.net" });
    expect(shareOrigin()).toBe("https://homelab.tail1234.ts.net");
    setInstance(selfHosted);
    expect(collectionShareUrl("abc")).toBe("https://sv.example.workers.dev/shared#abc");
  });
});
