import type { AuditEntry } from "@curseengine/engine";

/** Name used for table prefixes. One database per app, but the prefix keeps a shared database safe too. */
export const APP = "grimmod";

/** The SQL-facing interface the store needs. A `pg.Pool` satisfies it, and so does the pg-mem pool used in tests. */
export interface SqlConn {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
export interface SqlPool extends SqlConn {
  connect(): Promise<SqlConn & { release(err?: unknown): void }>;
  end?(): Promise<void>;
}

export type PersistenceStatus = "ok" | "degraded" | "down";

/**
 * Idempotent schema, applied on every boot.
 *  - `${APP}_state`: one JSONB snapshot row (id = 'host') plus the current grimoire `epoch`. Updated in place.
 *  - `${APP}_grimoire`: append-only. Rows are only ever INSERTed (reversals are new rows). A demo reset starts a new
 *    `epoch` rather than deleting anything.
 */
export const SCHEMA_SQL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS ${APP}_state (
     id text PRIMARY KEY,
     epoch integer NOT NULL,
     snapshot jsonb NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS ${APP}_grimoire (
     epoch integer NOT NULL,
     seq integer NOT NULL,
     entry jsonb NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (epoch, seq)
   )`,
  `CREATE INDEX IF NOT EXISTS ${APP}_grimoire_created_idx ON ${APP}_grimoire (created_at)`,
];

export interface Loaded<Snap> {
  snapshot: Snap | null;
  entries: AuditEntry[];
}

/** Postgres-backed store: loads and saves one snapshot plus the append-only grimoire. Writes are serialised. */
export class PgStore<Snap> {
  status: PersistenceStatus = "down";
  lastError: string | undefined;
  epoch = 1;
  /** Highest grimoire seq already inserted for the current epoch. */
  persistedSeq = 0;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly pool: SqlPool) {}

  /** Applies the schema and reads the saved state. Throws when the database is unreachable. */
  async init(): Promise<Loaded<Snap>> {
    for (const sql of SCHEMA_SQL) await this.pool.query(sql);
    const state = await this.pool.query(`SELECT epoch, snapshot FROM ${APP}_state WHERE id = 'host'`);
    const row = state.rows[0];
    if (!row) {
      this.epoch = 1;
      this.persistedSeq = 0;
      return { snapshot: null, entries: [] };
    }
    this.epoch = Number(row["epoch"]);
    const rows = await this.pool.query(`SELECT entry FROM ${APP}_grimoire WHERE epoch = $1 ORDER BY seq`, [this.epoch]);
    const entries = rows.rows.map((r) => r["entry"] as AuditEntry);
    this.persistedSeq = entries.length ? Math.max(...entries.map((e) => e.seq)) : 0;
    return { snapshot: row["snapshot"] as Snap, entries };
  }

  /**
   * Writes the snapshot and any grimoire entries not yet stored, in one transaction. `rotate` starts a new grimoire
   * epoch first (demo reset): old rows stay in the table, untouched. Serialised so concurrent requests cannot interleave.
   */
  save(snapshot: Snap, entries: readonly AuditEntry[], rotate = false): Promise<void> {
    const body = JSON.stringify(snapshot);
    const list = entries.slice();
    const run = async (): Promise<void> => {
      const epoch = rotate ? this.epoch + 1 : this.epoch;
      const from = rotate ? 0 : this.persistedSeq;
      const conn = await this.pool.connect();
      try {
        await conn.query("BEGIN");
        for (const e of list) {
          if (e.seq <= from) continue;
          await conn.query(`INSERT INTO ${APP}_grimoire (epoch, seq, entry) VALUES ($1, $2, $3::jsonb) ON CONFLICT (epoch, seq) DO NOTHING`, [epoch, e.seq, JSON.stringify(e)]);
        }
        await conn.query(
          `INSERT INTO ${APP}_state (id, epoch, snapshot, updated_at) VALUES ('host', $1, $2::jsonb, now())
           ON CONFLICT (id) DO UPDATE SET epoch = EXCLUDED.epoch, snapshot = EXCLUDED.snapshot, updated_at = now()`,
          [epoch, body],
        );
        await conn.query("COMMIT");
        conn.release();
      } catch (err) {
        try { await conn.query("ROLLBACK"); } catch { /* connection is gone */ }
        conn.release(err);
        throw err;
      }
      this.epoch = epoch;
      this.persistedSeq = list.length ? Math.max(from, ...list.map((e) => e.seq)) : from;
    };
    const next = this.tail.then(run, run);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

/** Short, secret-free description of a failure (never includes the connection string). */
export function describeError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; name?: unknown };
    if (typeof e.code === "string" && e.code) return e.code;
    if (typeof e.name === "string" && e.name) return e.name;
  }
  return "UnknownError";
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
