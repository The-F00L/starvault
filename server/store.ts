/**
 * The self-hosted server's copy of the user's catalog: one SQLite table, record-level last-write-wins.
 * The only file that touches SQLite, so `node:sqlite` can be swapped for better-sqlite3 here alone.
 */
import { randomUUID } from "node:crypto";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { PULL_PAGE, splitItemKey, type Change, type Kind, type PullPage, type StoredChange } from "./protocol";

interface Row {
  kind: string;
  key: string;
  data: string | null;
  updatedAt: string;
  deleted: number;
  rev: number;
}

const toChange = (r: Row): StoredChange => ({
  kind: r.kind as Kind,
  key: r.key,
  data: r.data === null ? null : JSON.parse(r.data),
  updatedAt: r.updatedAt,
  deleted: r.deleted === 1,
  rev: r.rev,
});

export class Store {
  private db: DatabaseSync;
  private getRow: StatementSync;
  private upsert: StatementSync;
  private since: StatementSync;
  private maxRev: StatementSync;
  readonly serverId: string;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS records (
        kind      TEXT NOT NULL,
        key       TEXT NOT NULL,
        data      TEXT,
        updatedAt TEXT NOT NULL,
        deleted   INTEGER NOT NULL DEFAULT 0,
        rev       INTEGER NOT NULL,
        PRIMARY KEY (kind, key)
      );
      CREATE INDEX IF NOT EXISTS records_rev ON records(rev);
      CREATE TABLE IF NOT EXISTS info (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.db.prepare("INSERT OR IGNORE INTO info (key, value) VALUES ('serverId', ?)").run(randomUUID());
    this.serverId = (this.db.prepare("SELECT value FROM info WHERE key = 'serverId'").get() as unknown as { value: string }).value;
    this.getRow = this.db.prepare("SELECT kind, key, data, updatedAt, deleted, rev FROM records WHERE kind = ? AND key = ?");
    this.upsert = this.db.prepare(`
      INSERT INTO records (kind, key, data, updatedAt, deleted, rev)
      VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(rev), 0) + 1 FROM records))
      ON CONFLICT (kind, key) DO UPDATE SET
        data = excluded.data, updatedAt = excluded.updatedAt, deleted = excluded.deleted, rev = excluded.rev
    `);
    this.since = this.db.prepare("SELECT kind, key, data, updatedAt, deleted, rev FROM records WHERE rev > ? ORDER BY rev LIMIT ?");
    this.maxRev = this.db.prepare("SELECT COALESCE(MAX(rev), 0) AS rev FROM records");
  }

  /** Store each change unless the stored row is as new or newer. Returns the winning row for every change. */
  push(changes: Change[]): StoredChange[] {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const results = changes.map((c) => {
        const stored = this.getRow.get(c.kind, c.key) as unknown as Row | undefined;
        // Timestamps are validated ISO strings, so string order is time order. Ties keep the stored row.
        if (stored && c.updatedAt <= stored.updatedAt) return toChange(stored);
        // An item added on a device that hadn't pulled its collection's deletion yet: it would be an orphan.
        const deleted = c.deleted || (c.kind === "item" && this.collectionDeleted(c.key));
        this.upsert.run(c.kind, c.key, deleted ? null : JSON.stringify(c.data), c.updatedAt, deleted ? 1 : 0);
        return toChange(this.getRow.get(c.kind, c.key) as unknown as Row);
      });
      this.db.exec("COMMIT");
      return results;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  private collectionDeleted(itemKey: string) {
    const collectionId = splitItemKey(itemKey)?.[0];
    const row = collectionId === undefined ? undefined : (this.getRow.get("collection", collectionId) as unknown as Row | undefined);
    return row?.deleted === 1;
  }

  /** Changes with rev > since, oldest first, at most `limit`. */
  pull(since: number, limit = PULL_PAGE): PullPage {
    const rows = this.since.all(since, limit + 1) as unknown as Row[];
    const changes = rows.slice(0, limit).map(toChange);
    const rev = changes.length ? changes[changes.length - 1].rev : (this.maxRev.get() as unknown as { rev: number }).rev;
    return { changes, rev, more: rows.length > limit, serverId: this.serverId };
  }

  close() {
    this.db.close();
  }
}
