import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, getSettings } from "./db";
import { setInstance } from "./instance";
import { buildDemoData } from "./mock";
import { metaChange, outboxEnabled } from "./outbox";
import { startRemoteSync } from "./remote";
import { __resetStartup, startApp } from "./startup";

// What the database held when sync was started: the demo vault and its outbox entries must already be gone.
let atSyncStart: Promise<{ demoRepos: number; outbox: number }> | null = null;
vi.mock("./remote", async (orig) => ({
  ...(await orig<typeof import("./remote")>()),
  startRemoteSync: vi.fn(() => {
    atSyncStart = Promise.all([db.repos.where("source").equals("mock").count(), db.outbox.count()]).then(([demoRepos, outbox]) => ({ demoRepos, outbox }));
    return () => {};
  }),
}));

const serve = (body: unknown, status = 200) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })));
const selfHosted = { mode: "self-hosted", login: "octo", avatarUrl: "https://a.example/octo", shareBaseUrl: null, tokenOk: true };

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  __resetStartup();
  atSyncStart = null;
  vi.mocked(startRemoteSync).mockClear();
});
afterEach(() => {
  setInstance({ mode: "public" });
  vi.unstubAllGlobals();
});

describe("startApp", () => {
  it("seeds the demo vault on a public deployment", async () => {
    serve({ error: "Not found" }, 404);
    await startApp();
    expect(await db.repos.where("source").equals("mock").count()).toBeGreaterThan(0);
    expect(outboxEnabled()).toBe(false);
    expect(startRemoteSync).not.toHaveBeenCalled();
  });

  // Review focus 1
  it("never keeps a demo vault when self-hosted, and starts syncing", async () => {
    const demo = buildDemoData();
    await db.repos.bulkPut(demo.repos);
    await db.meta.bulkPut(demo.meta);
    await db.collections.bulkPut(demo.collections);
    serve(selfHosted);
    await startApp();
    expect(await db.repos.count()).toBe(0);
    expect(await db.meta.count()).toBe(0);
    expect(await db.collections.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(await getSettings()).toMatchObject({ username: "octo", avatarUrl: "https://a.example/octo" });
    expect(outboxEnabled()).toBe(true);
    expect(startRemoteSync).toHaveBeenCalledTimes(1);
    expect(await atSyncStart).toEqual({ demoRepos: 0, outbox: 0 });
  });

  it("drops outbox entries queued from the demo vault before sync starts", async () => {
    const demo = buildDemoData();
    await db.repos.bulkPut(demo.repos);
    await db.meta.bulkPut(demo.meta);
    await db.outbox.add(metaChange(demo.meta[0]));
    serve(selfHosted);
    await startApp();
    expect(await db.outbox.count()).toBe(0);
    expect(await atSyncStart).toEqual({ demoRepos: 0, outbox: 0 });
  });

  it("can be retried after a failed boot", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(startRemoteSync).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    serve(selfHosted);
    await expect(startApp()).rejects.toThrow("boom");
    await startApp();
    expect(startRemoteSync).toHaveBeenCalledTimes(2);
  });

  it("boots only once (React StrictMode runs effects twice)", async () => {
    serve(selfHosted);
    await Promise.all([startApp(), startApp()]);
    expect(startRemoteSync).toHaveBeenCalledTimes(1);
  });
});
