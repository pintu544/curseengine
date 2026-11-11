# Design — Grimoire persistence hardening

## Schema versioning (`src/lib/persistence.ts`, both apps, identical apart from `APP`)

```
${APP}_meta(name text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())
  row: ('schema_version', '1')
```

- `MIGRATIONS: readonly Migration[]` where `Migration = { version, description, statements[] }`. Versions are consecutive from 1. `LATEST_SCHEMA_VERSION` is derived from the list, never hand-written.
- v1 = the three statements that were `SCHEMA_SQL` (state table, grimoire table, created_at index). All are `IF NOT EXISTS`, so adopting an unversioned database is the same code path as a fresh one; only the recorded version differs beforehand.
- `migrate(pool): Promise<number>` runs on one connection inside one transaction:
  1. `SELECT pg_advisory_xact_lock(hashtext('${APP}_schema'))` (released at COMMIT/ROLLBACK; serialises concurrent boots; the lock key is per app so a shared database does not make the apps wait on each other).
  2. `CREATE TABLE IF NOT EXISTS ${APP}_meta ...`.
  3. Read `schema_version` (absent = 0). Non-integer or negative: throw `SCHEMA_CORRUPT`. Greater than `LATEST_SCHEMA_VERSION`: throw `SCHEMA_TOO_NEW`. Both throw before any DDL on the data tables and roll back.
  4. For each migration with `version > current`, in order: run its statements, then upsert the version row.
  5. COMMIT. On any error ROLLBACK and release the connection with the error (same pattern as `PgStore.save`).
- Errors carry a `code` property so the existing `describeError` reports them without leaking anything.
- `PgStore.init()` calls `migrate` instead of looping `SCHEMA_SQL`, then stores the result in `PgStore.schemaVersion` (`number | null`, `null` until a migration succeeds). The rest of `init` (load snapshot, replay) is unchanged.
- Postgres DDL is transactional, which is what makes rule 9 (full rollback) true. Adding a v2 later means appending one `Migration`; nothing else changes.

Why a key/value meta table rather than a one-column table: the next hardening steps (e.g. recording the last boot time or app build) can add rows without a migration.

## Health (`src/lib/runtime.ts`, `app/api/health/route.ts`)

`persistenceHealth()` returns `{ mode: "postgres", status, schemaVersion, error? }`. `schemaVersion = r.hydrated && r.store ? r.store.schemaVersion : null`. If the boot attempt failed, hydrated stays false so the value is `null` (unknown), which is the honest answer. In-memory mode is unchanged: the function returns `undefined` and the route omits `persistence` (decision for rule 17: preserve the documented contract rather than invent a `{mode:"memory"}` object). The route file needs no logic change.

## Bounded suppressed list (GrimMod only, `src/lib/host.ts`)

- `export const SUPPRESSED_PERSIST_LIMIT = 200` beside `MAX_PERSISTED_DECISIONS`.
- `GrimModHost` keeps `suppressed` as the retained window and a private `suppressedCount`; `get suppressedTotal()` exposes it. A single private `recordSuppressed(item)` pushes, increments the counter and drops the oldest entries beyond the limit. `receive()` calls it in place of the bare `push`.
- `GrimmodSnapshot` gains `suppressedTotal?: number` (optional so pre-change snapshots type-check and restore). `snapshotState()` writes `suppressed` (already at most 200) and `suppressedTotal`. `restoreState()` loads the latest 200 and sets the counter to `max(snap.suppressedTotal ?? list.length, list.length)`.
- `app/api/grimoire/route.ts` reads `host.suppressedTotal` instead of `host.suppressed.length`; the 50-entry slice and `suppressedTruncated` rule are unchanged, so the payload shape and numbers are identical to before for any history, and stay identical after a restart.
- Why the in-memory window too: a snapshot that differed from memory would make "restored host equals live host" false and leave an unbounded array in a long-running process.
- Reset (`resetHost`) builds a new host, so the counter restarts at 0 with the list.

## Known limits

- The version row says the data tables exist. Dropping only the data tables while leaving `${APP}_meta` makes boot skip v1 and fail on first query (persistence then reports `down`/`degraded`). Operators wipe all three tables, or delete the `schema_version` row, to re-initialise (documented in both READMEs).
- pg-mem (the test substitute) has no advisory locks, cannot re-create a dropped table and does not roll back DDL. Tests shim the lock functions and assert rollback via the issued `ROLLBACK`/no `COMMIT` and the missing version row. Real-Postgres behaviour of the lock and DDL rollback is by design of Postgres, not demonstrated by this suite.

## Inviolables check

No engine file is touched or imported differently. No new action type; the grimoire table and its replay are untouched, still append-only. No network, no new dependency, no `eval`/`Function`.

## Test plan (maps to requirements 19, 20)

Both `test/persistence.test.ts` files: replace the weak "applies the schema idempotently" check with exact assertions on the meta row. The pg-mem pool registers `pg_advisory_xact_lock` and `hashtext` as no-op functions (pg-mem has no advisory locks; the lock is covered by a call-recording assertion, not by real contention, which pg-mem cannot reproduce). GrimMod adds a cap/total test file section driven through `getHost()`/`postEvent` plus a restart.
