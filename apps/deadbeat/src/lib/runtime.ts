import { Pool } from "pg";
import { DeadbeatHost, curseStore, getHost, type DeadbeatSnapshot } from "./host";
import { describeError, PgStore, withTimeout, type PersistenceStatus, type SqlPool } from "./persistence";

/**
 * Persistence wiring. Selected by environment: with DATABASE_URL unset nothing here runs and the host stays purely
 * in memory (the default). With it set, the host is hydrated from Postgres on first use and saved after each mutation.
 * The connection string is only ever read from the environment.
 */

/** How long one connect, schema and load attempt may take before the app boots without the database. */
export const INIT_TIMEOUT_MS = 8000;
/** Minimum gap between re-connection attempts while the database is down. */
export const RETRY_AFTER_MS = 15000;

interface Runtime {
  pool: SqlPool | null;
  store: PgStore<DeadbeatSnapshot> | null;
  hydrated: boolean;
  /** True when something changed in memory while the database was down, so a late reconnect must not overwrite or reload. */
  dirty: boolean;
  /** A demo reset happened and the next successful save must start a new grimoire epoch. */
  pendingRotate: boolean;
  inflight: Promise<void> | null;
  lastAttempt: number;
  lastError: string | undefined;
}

const KEY = "__deadbeatPersistence";
type G = typeof globalThis & { [KEY]?: Runtime };

const blank = (): Runtime => ({ pool: null, store: null, hydrated: false, dirty: false, pendingRotate: false, inflight: null, lastAttempt: 0, lastError: undefined });
const rt = (): Runtime => ((globalThis as G)[KEY] ??= blank());

const databaseUrl = (): string | undefined => process.env["DATABASE_URL"]?.trim() || undefined;

/** True when persistence is switched on (a pool was injected, or DATABASE_URL is set). */
export function persistenceConfigured(): boolean {
  return rt().pool !== null || databaseUrl() !== undefined;
}

function poolFromEnv(url: string): SqlPool {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5000, max: 4 });
  // An idle-client error must never take the process down.
  pool.on("error", () => undefined);
  return pool as unknown as SqlPool;
}

/** Test hook: use this pool instead of DATABASE_URL (or `null` to clear), dropping all persistence runtime state. */
export function usePersistencePool(pool: SqlPool | null): void {
  (globalThis as G)[KEY] = { ...blank(), pool };
}

async function attempt(r: Runtime): Promise<void> {
  r.lastAttempt = Date.now();
  try {
    const url = databaseUrl();
    r.pool ??= url ? poolFromEnv(url) : null;
    if (!r.pool) return;
    const store = (r.store ??= new PgStore<DeadbeatSnapshot>(r.pool));
    const { snapshot, entries } = await withTimeout(store.init(), INIT_TIMEOUT_MS);
    // Read AFTER the await: a mutation that landed while init() was in flight also makes memory the working copy.
    if (r.dirty) {
      if (snapshot) {
        // The database holds state this process never loaded, and memory has diverged from it. Overwriting the snapshot
        // row would destroy that state, and saving into its epoch would silently drop colliding grimoire seqs.
        // Stay unhydrated (health reports down with this code) and leave the database untouched until an operator decides.
        r.lastError = "HYDRATE_CONFLICT";
        store.status = "down";
        store.lastError = r.lastError;
        return;
      }
      // Empty database: nothing to reload or overwrite. Keep the in-memory host; the pending save flushes it, including
      // every grimoire entry recorded while the database was down (store.persistedSeq is 0, so all of them are inserted).
    } else if (snapshot) {
      const host = new DeadbeatHost();
      host.restoreState(snapshot, entries);
      (globalThis as typeof globalThis & { __deadbeatHost?: DeadbeatHost }).__deadbeatHost = host;
      const curses = curseStore();
      curses.clear();
      for (const c of host.getCurses()) curses.set(c.name, c);
    }
    r.hydrated = true;
    r.lastError = undefined;
    store.status = "ok";
    store.lastError = undefined;
  } catch (err) {
    r.lastError = describeError(err);
    if (r.store) { r.store.status = "down"; r.store.lastError = r.lastError; }
  }
}

/** Runs one (re)connection attempt unless one is in flight (then waits for it) or the last one was under RETRY_AFTER_MS ago. */
async function reconnect(r: Runtime): Promise<void> {
  if (r.inflight) await r.inflight;
  else if (Date.now() - r.lastAttempt >= RETRY_AFTER_MS) {
    r.inflight = attempt(r).finally(() => { r.inflight = null; });
    await r.inflight;
  }
}

/**
 * The host, hydrated from Postgres when persistence is on. Never throws because of the database: if it is unreachable
 * the host boots empty in memory and `persistenceHealth()` says so. While the database is down a reconnection is retried
 * at most every RETRY_AFTER_MS, also after something changed in memory (see `attempt`: a dirty host is never replaced).
 */
export async function getHostReady(): Promise<DeadbeatHost> {
  if (!persistenceConfigured()) return getHost();
  const r = rt();
  if (!r.hydrated) await reconnect(r);
  return getHost();
}

/**
 * Saves the host after a mutation. Never throws: a failed write marks persistence degraded and the request still
 * succeeds from memory; the next successful save also stores any grimoire entries that were missed.
 * `rotate` is for demo resets: it starts a new grimoire epoch (old rows are kept).
 */
export async function persistHost(host: DeadbeatHost, opts: { rotate?: boolean } = {}): Promise<void> {
  if (!persistenceConfigured()) return;
  const r = rt();
  if (opts.rotate) r.pendingRotate = true;
  if (!r.hydrated || !r.store) {
    // Memory is now the working copy. Retry the database (rate limited); if it is back, the save below flushes the
    // entries recorded while it was down. If not, they stay in memory and the next save tries again.
    r.dirty = true;
    await reconnect(r);
    if (!r.hydrated || !r.store) return;
  }
  try {
    const rotate = r.pendingRotate;
    await r.store.save(host.snapshotState(), host.grimoire.entries, rotate);
    if (rotate) r.pendingRotate = false;
    r.store.status = "ok";
    r.store.lastError = undefined;
  } catch (err) {
    r.store.status = "degraded";
    r.store.lastError = describeError(err);
  }
}

/** Reported by /api/health. `undefined` when persistence is off, so the in-memory response is unchanged. */
export function persistenceHealth(): { mode: "postgres"; status: PersistenceStatus; schemaVersion: number | null; error?: string } | undefined {
  if (!persistenceConfigured()) return undefined;
  const r = rt();
  const status: PersistenceStatus = r.hydrated && r.store ? r.store.status : "down";
  const error = r.hydrated && r.store ? r.store.lastError : r.lastError;
  // Unknown (null) until a boot migration has succeeded: a down or too-new database has no version we can vouch for.
  const schemaVersion = r.hydrated && r.store ? r.store.schemaVersion : null;
  return { mode: "postgres", status, schemaVersion, ...(error ? { error } : {}) };
}
