/**
 * Client side of self-hosted sync. IndexedDB stays the working copy: this pushes the outbox to
 * POST /api/sync and pulls other devices' changes from GET /api/sync. Record-level last-write-wins.
 */
import { liveQuery } from "dexie";
import { MAX_BATCH, MAX_BODY_BYTES, splitItemKey, type Change, type PullPage, type StoredChange } from "../../server/protocol";
import { DEFAULT_SYNC_STATE, type StarVaultDB } from "./db";
import { enqueueAll } from "./outbox";
import type { Collection, CollectionItem, ListOverride, OutboxEntry, RepoMeta, SyncState } from "./types";

/** Stay comfortably under the server's 1 MB body limit. */
const MAX_BATCH_BYTES = Math.floor(MAX_BODY_BYTES * 0.9);

export class SyncError extends Error {
  constructor(
    message: string,
    /** True when trying again later may work (server unreachable, 5xx). */
    readonly retry: boolean,
  ) {
    super(message);
  }
}

const toChange = ({ kind, key, data, updatedAt, deleted }: OutboxEntry): Change => ({ kind, key, data, updatedAt, deleted });
const byteSize = (e: OutboxEntry) => new TextEncoder().encode(JSON.stringify(toChange(e))).length + 1;

async function httpError(res: Response): Promise<SyncError> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  // Other 4xx answers (wrong route, refused host or content type) won't change by asking again.
  const retry = res.status >= 500 || res.status === 408 || res.status === 429;
  return new SyncError(body?.error ?? `Server returned ${res.status}`, retry);
}

const sameProcessLocks = new Map<string, Promise<unknown>>();

/** Run fn while holding a lock shared by every tab of this origin (Web Locks), so tabs never sync at once. */
function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request(name, fn);
  const run = (sameProcessLocks.get(name) ?? Promise.resolve()).then(fn);
  sameProcessLocks.set(name, run.catch(() => undefined));
  return run;
}

/** Write a change from the server into the local tables. Never queues anything. */
export async function applyChange(db: StarVaultDB, c: Change) {
  switch (c.kind) {
    case "meta":
      if (c.deleted) await db.meta.delete(c.key);
      else await db.meta.put(c.data as RepoMeta);
      return;
    case "collection":
      if (c.deleted) {
        await db.items.where("collectionId").equals(c.key).delete();
        await db.collections.delete(c.key);
      } else await db.collections.put(c.data as Collection);
      return;
    case "item": {
      const key = splitItemKey(c.key);
      if (!key) return;
      if (c.deleted) await db.items.delete(key);
      else await db.items.put(c.data as CollectionItem);
      return;
    }
    case "listOverride": {
      if (c.deleted) return;
      const o = c.data as ListOverride;
      if (await db.collections.get(c.key)) {
        await db.collections.update(c.key, { icon: o.icon, rules: o.rules });
        return;
      }
      // This device hasn't imported the List yet; applyListsSync applies it when it does.
      const s = (await db.syncState.get("main")) ?? DEFAULT_SYNC_STATE;
      await db.syncState.put({ ...s, pendingOverrides: { ...s.pendingOverrides, [c.key]: o } });
    }
  }
}

export class RemoteSync {
  constructor(
    private db: StarVaultDB,
    private fetchFn: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  /** One full round: merge everything on first connection, push the outbox, pull. Rounds never overlap. */
  sync(): Promise<void> {
    return this.exclusive(async () => {
      try {
        if (!(await this.state()).firstSyncDone) await enqueueAll(this.db);
        await this.push();
        if ((await this.pullAll()) === "reset") {
          // The server lost our history (new or restored database): send everything again, then read it all back.
          await enqueueAll(this.db);
          await this.push();
          await this.pullAll();
        }
        await this.patchState({ firstSyncDone: true, lastError: null });
      } catch (e) {
        await this.patchState({ lastError: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    });
  }

  /**
   * Pull only; pending local edits are left for the next push. If the server lost our history, read it all
   * back from the start; firstSyncDone is now false, so the next sync() sends everything again.
   */
  pull(): Promise<void> {
    return this.exclusive(async () => {
      if ((await this.pullAll()) === "reset") await this.pullAll();
    });
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    return withLock(`starvault-sync:${this.db.name}`, fn);
  }

  private async state(): Promise<SyncState> {
    return (await this.db.syncState.get("main")) ?? DEFAULT_SYNC_STATE;
  }

  private async patchState(patch: Partial<SyncState>) {
    await this.db.transaction("rw", this.db.syncState, async () => {
      await this.db.syncState.put({ ...(await this.state()), ...patch, key: "main" });
    });
  }

  private async request(path: string, body?: unknown): Promise<Response> {
    const init: RequestInit =
      body === undefined
        ? { headers: { Accept: "application/json" } }
        : { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body) };
    try {
      return await this.fetchFn(path, init);
    } catch {
      throw new SyncError("Server unreachable", true);
    }
  }

  /** Oldest pending entries: at most MAX_BATCH, and under MAX_BATCH_BYTES unless a single entry is bigger. */
  private async nextBatch(): Promise<OutboxEntry[]> {
    const pending = await this.db.outbox.filter((e) => !e.rejected).limit(MAX_BATCH).toArray();
    const batch: OutboxEntry[] = [];
    let bytes = 0;
    for (const e of pending) {
      const size = byteSize(e);
      if (batch.length && bytes + size > MAX_BATCH_BYTES) break;
      batch.push(e);
      bytes += size;
    }
    return batch;
  }

  private async push() {
    for (;;) {
      const batch = await this.nextBatch();
      if (!batch.length) return;
      const res = await this.request("/api/sync", { changes: batch.map(toChange) });
      if (res.status === 400 || res.status === 413) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string; index?: number };
        // 413 only happens for a single oversized entry, since batches are size-capped.
        const bad = res.status === 413 ? batch[0] : typeof body.index === "number" ? batch[body.index] : undefined;
        if (!bad) throw new SyncError(body.error ?? "The server rejected the changes", false);
        console.warn(`[starvault] server rejected ${bad.kind} ${bad.key}: ${body.error ?? res.status}`);
        await this.db.outbox.update(bad.seq!, { rejected: body.code ?? "REJECTED" });
        continue;
      }
      if (!res.ok) throw await httpError(res);
      const { results } = (await res.json()) as { results: StoredChange[] };
      await this.db.transaction("rw", [this.db.outbox, this.db.meta, this.db.collections, this.db.items, this.db.syncState], async () => {
        for (const [i, sent] of batch.entries()) {
          // Gone means a newer local edit replaced it while the request was in flight; that one goes out next.
          if (!(await this.db.outbox.get(sent.seq!))) continue;
          await this.db.outbox.delete(sent.seq!);
          const winner = results[i];
          if (winner && (winner.updatedAt !== sent.updatedAt || winner.deleted !== sent.deleted)) await applyChange(this.db, winner); // the server had a newer version
        }
      });
      await this.patchState({ lastPushAt: new Date().toISOString() });
    }
  }

  private async pullAll(): Promise<"done" | "reset"> {
    for (;;) {
      const { rev: since, serverId } = await this.state();
      const res = await this.request(`/api/sync?since=${since}`);
      if (!res.ok) throw await httpError(res);
      const page = (await res.json()) as PullPage;
      // A different database id is the reliable sign; a rev that went backwards covers older servers.
      if ((serverId && page.serverId && page.serverId !== serverId) || page.rev < since) {
        await this.patchState({ rev: 0, firstSyncDone: false, serverId: page.serverId ?? null });
        return "reset";
      }
      await this.db.transaction("rw", [this.db.outbox, this.db.meta, this.db.collections, this.db.items, this.db.syncState], async () => {
        for (const c of page.changes) {
          // A pending local edit wins for now; the next push settles it against the server.
          const pending = await this.db.outbox.where("[kind+key]").equals([c.kind, c.key]).filter((e) => !e.rejected).count();
          if (!pending) await applyChange(this.db, c);
        }
        await this.patchState({ rev: page.rev, serverId: page.serverId ?? serverId, lastPullAt: new Date().toISOString() });
      });
      if (!page.more) return "done";
    }
  }
}

/**
 * Browser wiring: sync on start, when the tab becomes visible, when the network returns, every 5 minutes,
 * and 1 s after local writes. While the server is unreachable, retry with backoff from 5 s up to 5 min.
 */
export function startRemoteSync(remote: RemoteSync, db: StarVaultDB): () => void {
  let retryMs = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let writeTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  async function run() {
    clearTimeout(retryTimer);
    retryTimer = undefined;
    try {
      await remote.sync();
      retryMs = 0;
    } catch (e) {
      if (stopped || !(e instanceof SyncError && e.retry)) return;
      retryMs = Math.min(retryMs ? retryMs * 2 : 5_000, 300_000);
      retryTimer = setTimeout(run, retryMs);
    }
  }
  const afterWrite = () => {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(run, 1_000);
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") void run();
  };
  const onOnline = () => void run();

  const pending = liveQuery(() => db.outbox.filter((e) => !e.rejected).count()).subscribe({
    next: (n) => {
      if (n > 0) afterWrite();
    },
  });
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onOnline);
  const interval = setInterval(onOnline, 5 * 60_000);
  void run();

  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    clearTimeout(writeTimer);
    clearInterval(interval);
    pending.unsubscribe();
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onOnline);
  };
}
