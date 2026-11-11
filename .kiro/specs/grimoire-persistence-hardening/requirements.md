# Requirements — Grimoire persistence hardening (Slice 4, Session 1)

Scope: the Postgres persistence added in the "Persistence" commit (`apps/*/src/lib/persistence.ts`, `runtime.ts`) for BOTH apps (`apps/grimmod`, `apps/deadbeat`). Hardens it; adds no feature. Origin: Slice-3 QA warning W1 (GrimMod's persisted snapshot keeps the `suppressed` list unbounded) plus the lack of any schema version.

Hard constraints (from `.kiro/steering/inviolables.md`): ZERO changes under `packages/curse-engine`; no new dependencies; no `eval`/`Function`; the grimoire stays append-only and every action stays reversible; TypeScript strict.

## Schema versioning

1. The system SHALL record the applied schema version in a per-app meta table `${APP}_meta` (`name text PRIMARY KEY`, `value text NOT NULL`, `updated_at timestamptz`), as the row `name = 'schema_version'`.
2. WHEN the app boots with persistence on THEN it SHALL run an ordered list of numbered migrations, applying only those whose version is greater than the recorded version, and record the new version in the same transaction as the migration's statements.
3. Migration v1 SHALL be exactly the current schema: `${APP}_state`, `${APP}_grimoire` and the `created_at` index.
4. WHEN the database is fresh THEN boot SHALL end at the latest version. WHEN the database predates versioning (v1 tables exist, no meta row) THEN boot SHALL adopt it as v1 without altering or losing any row. Both paths SHALL converge on an identical schema.
5. Running the migration any number of times SHALL be a no-op after the first (idempotent): same version, no error, no data change.
6. WHEN two instances boot at once THEN migrations SHALL be serialised by a transaction-scoped advisory lock so DDL cannot interleave.
7. WHEN the recorded version is HIGHER than the newest migration this build knows (a newer deployment wrote it) THEN boot SHALL refuse to touch the schema, fail persistence with the short code `SCHEMA_TOO_NEW`, and the app SHALL keep serving from memory (the existing degraded-boot contract). It SHALL NOT downgrade or rewrite the version.
8. WHEN the stored version value is not a non-negative integer THEN boot SHALL fail persistence with the code `SCHEMA_CORRUPT` and change nothing.
9. A failed migration SHALL roll back completely (no half-applied version).

## Bounded suppressed list (W1)

10. The persisted GrimMod snapshot SHALL contain at most the latest 200 `suppressed` entries (`SUPPRESSED_PERSIST_LIMIT = 200`).
11. The snapshot SHALL also carry `suppressedTotal`, the exact number of messages ever suppressed since the last reset, so the total survives truncation and restarts.
12. WHEN a snapshot written before this change (no `suppressedTotal`) is restored THEN the total SHALL default to the length of its list.
13. `GET /api/grimoire` behaviour SHALL be unchanged for clients: `suppressedTotal` = the exact total, `suppressed` = the latest 50, `suppressedTruncated` = total > 50. This SHALL hold identically before and after a restart, including after more than 200 suppressions.
14. The in-memory host SHALL retain the same latest-200 window (so memory does not grow without bound and a restored host equals the live host). Entries older than the window are not recoverable; the count is.
15. Deadbeat has no suppressed list; its snapshot SHALL NOT change shape. Both snapshots keep `v: 1`; the snapshot version and the schema version are independent.

## Health

16. WHEN persistence is on THEN `GET /api/health` SHALL return `persistence: { mode: "postgres", status, schemaVersion, error? }` where `schemaVersion` is the integer recorded in the database after a successful boot migration, and `null` when the schema state is unknown (the boot attempt failed, e.g. database down, `SCHEMA_TOO_NEW`).
17. WHEN persistence is off (no `DATABASE_URL`) THEN the health body SHALL keep having NO `persistence` field (existing documented contract; there is no schema to report). This is pinned by a test in both apps.
18. Health SHALL stay HTTP 200 in every case and SHALL NOT include the connection string.

## Verification

19. Tests (Vitest, pg-mem as the documented substitute) SHALL cover, in both apps: fresh boot to v1; legacy adoption keeps rows; repeated boot is a no-op; `SCHEMA_TOO_NEW` and `SCHEMA_CORRUPT` leave the DB untouched and the app serving; rollback on failure; health `schemaVersion` in postgres, down and in-memory modes. In GrimMod additionally: the 200 cap, total preserved across restart, legacy snapshot restore, and API 50 + total consistency.
20. `pnpm -r test` and `pnpm -r typecheck` SHALL be green; `git diff --stat` for the change SHALL list no file under `packages/curse-engine`.
