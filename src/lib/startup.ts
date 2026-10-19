/**
 * App boot. The mode must be known before any data is touched: the demo vault is public-only, and in
 * self-hosted mode it must never mix with, or be pushed alongside, the synced catalog.
 */
import { db, saveSettings } from "./db";
import { detectInstance, setInstance } from "./instance";
import { clearDemo, seedDemoIfEmpty } from "./mock";
import { RemoteSync, startRemoteSync } from "./remote";

/** The app's sync engine (idle on the public site). */
export const remote = new RemoteSync(db);

let booting: Promise<void> | null = null;

/** Idempotent: React StrictMode runs effects twice in development. */
export function startApp(): Promise<void> {
  return (booting ??= boot().catch((e) => {
    console.error("StarVault startup failed", e);
    booting = null; // let a later call retry instead of caching the failure
    throw e;
  }));
}

async function boot() {
  const instance = await detectInstance();
  setInstance(instance);
  if (instance.mode !== "self-hosted") {
    await seedDemoIfEmpty();
    return;
  }
  // Order matters: the demo vault must be gone before sync starts, because the outbox's queue() isn't
  // demo-guarded and firstSyncDone is set even when enqueueAll skipped a demo vault.
  await clearDemo();
  // The server's token decides whose stars these are.
  if (instance.login) await saveSettings({ username: instance.login, avatarUrl: instance.avatarUrl });
  startRemoteSync(remote, db);
}

/** Tests only. */
export function __resetStartup() {
  booting = null;
}
