# Tasks — Grimoire persistence hardening

- [x] 1. Specs: requirements, design, tasks written and consistent with the Slice-3 QA W1 text. _R1-R20_
- [x] 2. `persistence.ts` (both apps): `${APP}_meta`, `MIGRATIONS` (v1), `migrate()` with advisory lock, `SCHEMA_TOO_NEW` / `SCHEMA_CORRUPT`, `PgStore.schemaVersion`. _R1-R9_
- [x] 3. `runtime.ts` (both apps): `persistenceHealth()` adds `schemaVersion` (`null` when unknown); in-memory response unchanged. _R16-R18_
- [x] 4. GrimMod `host.ts`: `SUPPRESSED_PERSIST_LIMIT = 200`, `recordSuppressed`, `suppressedTotal`, snapshot field, restore default. _R10-R14_
- [x] 5. GrimMod `app/api/grimoire/route.ts`: use `suppressedTotal`; payload unchanged. _R13_
- [x] 6. Tests, both apps: fresh boot, legacy adoption, no-op re-boot, too-new, corrupt, rollback, health in postgres / down / memory. _R19_
- [x] 7. Tests, GrimMod: cap at 200, total preserved across restart, legacy snapshot restore, API 50 + total. _R19_
- [x] 8. READMEs (both apps) describe the meta table, versioning and `schemaVersion`; `docs/KIRO-USAGE.md` updated; `git diff --stat` shows nothing under `packages/curse-engine`. _R20_
- [x] 9. `pnpm -r test` and `pnpm -r typecheck` green.
