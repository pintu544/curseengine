# Deadbeat

Invoice-chasing demo on the unmodified CurseEngine. Next.js (App Router) and Tailwind, structured like GrimMod. Advancing a fixture clock emits one `tick` event per invoice through the same executor; the mail adapter delivers to an in-app **outbox**. Nothing is ever sent to a real address.

## Run
```
pnpm install
pnpm --filter @curseengine/deadbeat build
pnpm --filter @curseengine/deadbeat start    # http://localhost:3001
pnpm --filter @curseengine/deadbeat dev      # development server
pnpm --filter @curseengine/deadbeat test
pnpm --filter @curseengine/deadbeat sim:fixtures
```
Scripts use webpack (`--webpack`) for the same reason as GrimMod: the engine is consumed from TypeScript source.

## Try the storyline
1. Press **Load fixtures** to install the three tier curses (or install one from the editor).
2. Press **Advance clock +1 day**. Invoices that are at least 7 days overdue get the polite nudge in the outbox; the 3-day invoice gets nothing.
3. Keep advancing. At 14 days the firm reminder is sent, at 21 days an escalation appears in the owner inbox. Each tier is sent once per invoice.
4. In the grimoire, **Undo** an email: its outbox message is marked retracted, the entry stays, and a reversal entry is appended.

## Tier curses
| Curse | Rule |
|---|---|
| `late-payers` | `every 1 day where days_overdue >= 7 -> email polite-nudge to client` |
| `late-payers-firm` | `every 1 day where days_overdue >= 14 -> email firm-reminder to client` |
| `late-payers-escalate` | `every 1 day where days_overdue >= 21 -> escalate to owner` |

Tick fields: `invoice_id`, `days_overdue`, `client` (the email address), `client_name`, `amount`.

## API
| Route | What |
|---|---|
| `POST /api/curses` | `{source}` -> 201 `{id, graph}` or 422 `{line, message}` |
| `GET /api/curses/:id/graph` | Rule graph, or 404 |
| `POST /api/curses/:id/simulate` | Recording-stub run over one tick per fixture invoice; touches no live state |
| `GET /api/events` | Invoices, clock, outbox, escalations, latest decision |
| `POST /api/events` | Clock tick: `{days?}` whole days, default 1, 0 to 90; 400 on bad input |
| `GET /api/grimoire` | Audit entries with `reversed` and `reversible` flags |
| `POST /api/grimoire/:id/undo` | 200 with the reversal entry, 404 unknown, 409 already reversed |
| `POST /api/fixtures` | Full demo reset, then installs the tier curses (`reset: true`) |
| `POST /api/reset` | Full demo reset: fixtures restored, curses removed, outbox and grimoire discarded (`reset: true` and a note say so) |
| `GET /api/health` | `{ok: true, app: "deadbeat", engineEnabled}` |

## FR9 kill switch
One flag at the host boundary silences this app: set `CURSE_ENGINE_ENABLED=off` (also `0` or `false`, any case) before starting the server. It defaults to on. It is read on every call, and `host.setEngineEnabled(false)` overrides it in code (used by the tests).

While it is off, `POST /api/events` returns **503** (`host.advanceClock` throws `EngineDisabledError`) with `{disabled: true, killSwitch: "CURSE_ENGINE_ENABLED", message}` and nothing else happens: the clock does not move, no tick is emitted, no email reaches the outbox, no escalation is raised and no grimoire entry is written. `GET /api/health` reports `engineEnabled`. Reading state and undoing earlier grimoire entries stay available, because undo only reverses what the engine already did. A multi-day advance checks the switch at the start of every day, so a day is all-or-nothing. If the switch goes off part-way, the days already finished stay applied, the rest are skipped and the response carries `interrupted: true` with `days` set to the days actually applied. The programmatic override survives `POST /api/reset` and `POST /api/fixtures`. Dry runs (`simulate`) never touch live state and still work while it is off. The shared helper (`CURSE_ENGINE_ENABLED` parsing and `EngineDisabledError`) lives in `packages/kill-switch`. Turn the flag back on and normal behaviour resumes. Proof: `test/killswitch.test.ts`.

## Behaviour notes and limits
- The executor dedupes nothing. The host tracks which curse has acted on which invoice and hands the executor only curses not yet sent for that invoice, so repeated ticks create no duplicate emails, no taken actions and no grimoire entries.
- **Undo does not re-arm a tier.** After an email is retracted it is not re-sent for that invoice. This keeps "at most once" simple and honest.
- The clock only moves forward. At the reference clock the older invoices are already past several thresholds, so the first tick sends tiers 1, 2 and 3 to the invoices that qualify (a catch-up); later ticks add nothing for them.
- Fixture data is in `src/lib/fixtures.ts` (stable ids, reference clock 2026-11-11T12:00:00Z; invoices 3, 8, 15, 22 and 40 days overdue).
- Simulation uses one tick per invoice at the reference clock, so it is a "what would run now" snapshot, not a multi-day replay.
- Single process, in-memory state on `globalThis`. No authentication: local demo only, do not expose it.
- `DeadbeatHost.intake` is the single point where events reach the executor; the FR9 kill switch is enforced there and at the start of `advanceClock`.

## Persistence (Azure Database for PostgreSQL)

Selected by environment. With `DATABASE_URL` **unset** (the default, and what the tests use) all state lives in memory exactly as before. With it **set**, state is saved to PostgreSQL after every change and restored on boot. The connection string is read only from the environment and is never logged or returned by the API. Azure needs TLS, so use a URL ending in `?sslmode=require`.

**Shape** (versioned and migrated idempotently on every boot, see "Schema versioning" below; code in `src/lib/persistence.ts`, wiring in `src/lib/runtime.ts`):

| Table | Purpose |
| --- | --- |
| `deadbeat_meta` | Key/value bookkeeping. The row `schema_version` records the last migration applied. |
| `deadbeat_state` | One row (`id = 'host'`) holding a JSONB snapshot: invoices, the host clock, outbox, escalations, sent-tier tracking, the tick counter, installed curses, decisions (newest 500) and the kill-switch override. Also holds the current grimoire `epoch`. Updated in place. |
| `deadbeat_grimoire` | Append-only, primary key `(epoch, seq)`, one JSONB entry per row. The app only ever runs `INSERT`. An undo is a new row (a reversal entry; the outbox message is only marked retracted in the snapshot); no entry is updated or deleted. |

The snapshot and any new grimoire rows are written in one transaction. On boot the grimoire is replayed through the engine's own audit log API, which must reproduce the stored ids exactly or persistence is reported as down.

**Schema versioning.** On every boot the app runs its numbered migrations (`MIGRATIONS` in `src/lib/persistence.ts`) in one transaction, under a transaction-scoped advisory lock so two instances booting together cannot interleave DDL. Only migrations newer than the recorded `schema_version` run, and the version is written in the same transaction. Version 1 is the state and grimoire tables. A fresh database and a database from before versioning both end at version 1 (the old rows are untouched); running it again does nothing. If the database was already migrated by a NEWER build (`schema_version` above what this build knows) the app does not touch it: persistence reports `down` with `error: "SCHEMA_TOO_NEW"` and the app keeps serving from memory. An unreadable version reports `SCHEMA_CORRUPT`.

**What a reset means.** `POST /api/reset` and `POST /api/fixtures` start a new grimoire epoch: the visible grimoire becomes empty and the snapshot is replaced, while older epochs stay in the table as history. Wiping the database yourself (dropping all three tables including `deadbeat_meta`, or deleting the `deadbeat_state` row; dropping only the data tables would leave `schema_version` saying they exist) gives a clean start at the next boot.

**Not persisted:** the executor's quota usage (sent tiers are persisted, so a tier is never re-sent after a restart). Only one app instance should write to a database (the in-process state is the working copy).

**If the database is unreachable.** The app still boots and serves. `GET /api/health` stays HTTP 200 and adds `persistence: { mode: "postgres", status, schemaVersion, error? }`, where `status` is `ok`, `degraded` (a write failed; requests still work from memory and the next good write catches up) or `down` (could not connect or load at boot; running in memory, re-tried at most every 15 seconds until something changes in memory, after which a restart is needed). `schemaVersion` is the integer recorded in the database after the boot migration, or `null` when it is unknown (the database was unreachable or refused). `error` is a short code such as `ECONNREFUSED`, never the connection string. With `DATABASE_URL` unset the health body has no `persistence` field.

**How it is tested.** `test/persistence.test.ts` uses pg-mem, an in-process PostgreSQL emulator, through the same `pg` Pool interface. It is a substitute, not a real server, so it shows the SQL and restart logic work against that emulator only. The unreachable-database test uses the real `pg` driver against a closed local port.
