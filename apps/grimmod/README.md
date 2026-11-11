# GrimMod

Chat-moderation demo on the unmodified CurseEngine. Next.js (App Router) and Tailwind. This is the T1.5 shell: demo chat, curse editor, rule-graph inspector and a live executor host. The simulator and grimoire arrive in Slice 2.

## Run
```
pnpm install
pnpm --filter @curseengine/grimmod build
pnpm --filter @curseengine/grimmod start    # http://localhost:3000
pnpm --filter @curseengine/grimmod dev      # development server
pnpm --filter @curseengine/grimmod test     # host, adapter, graph and API tests
```
Scripts use webpack (`--webpack`) because the engine is consumed from TypeScript source with `.js` import suffixes, which `next.config.mjs` aliases to `.ts`.

## Try the storyline
1. The editor is pre-filled with the `spam-strikes` curse. Press **Install curse** to see its rule graph (trigger, condition, actions).
2. Edit the source into something invalid and install again: the exact line and message appear inline (HTTP 422).
3. Press **Raid-bot burst**. Five flagged messages arrive from `raid-bot`. It is muted on the third, later messages show as muted, and one escalation appears in the owner inbox.

## Layout
| Path | What |
|---|---|
| `src/lib/fixtures.ts` | Fixture chat history (stable IDs), raid-bot burst generator |
| `src/lib/chat-state.ts` | In-memory messages, mutes with expiry, owner escalations |
| `src/lib/adapter.ts` | Capabilities `mute`, `post`, `escalate` over chat state (`email` is undeclared) |
| `src/lib/host.ts` | `GrimModHost`: turns chat messages into engine events and feeds the executor |
| `src/lib/graph.ts` | Curse AST to rule-graph nodes and edges |
| `app/api/*` | `POST /api/curses`, `GET /api/curses/:id/graph`, `GET`/`POST /api/events`, `GET /api/health`, `POST /api/reset` |

## FR9 kill switch
One flag at the host boundary silences this app: set `CURSE_ENGINE_ENABLED=off` (also `0` or `false`, any case) before starting the server. It defaults to on. It is read on every call, and `host.setEngineEnabled(false)` overrides it in code (used by the tests).

While it is off, `POST /api/events` returns **503** (`host.receive` throws `EngineDisabledError`) with `{disabled: true, killSwitch: "CURSE_ENGINE_ENABLED", message}` and nothing else happens: no chat message is stored, no decision is made, no mute or escalation is applied, and no grimoire entry is written. `GET /api/health` reports `engineEnabled`. Reading state and undoing earlier grimoire entries stay available, because undo only reverses what the engine already did. The programmatic override survives `POST /api/reset` and `POST /api/fixtures`. Dry runs (`simulate`) never touch live state and still work while it is off. The shared helper (`CURSE_ENGINE_ENABLED` parsing and `EngineDisabledError`) lives in `packages/kill-switch`. Turn the flag back on and normal behaviour resumes. Proof: `test/killswitch.test.ts`.

## Behaviour notes
- Fixture history is display only. The executor sees live events, so counts start from zero.
- A muted author's later messages are stored as muted and are not fed to the executor, so a mute and an escalation happen once, not on every further message.
- Installing or replacing a curse keeps the executor, so count history and per-curse quota usage survive. The curse list is edited in place, and the engine reads it by reference, so `packages/curse-engine/src` needed no change. Replacing a curse keeps the quota usage recorded under its name. `POST /api/reset` clears everything.
- A curse that uses an undeclared capability (for example `email`) installs fine. On each event it gets a `failed` decision record (kept in the decision log), `POST /api/events` still returns 200, and other curses still run. Such a curse runs in its own executor, which only sees events from its install onwards, so its condition counts can be lower than those of a normal curse.
- The message is always stored in chat, even when a curse fails on it.
- GrimMod emits no `tick` events, so `every` curses install and show a graph but do not run here (Deadbeat is the tick host).
- A muted author's earlier flagged events still count after the mute expires, so the next flagged message mutes again straight away.
- Single process only: state is held in memory on `globalThis`, and each server instance has its own.

## Known follow-ups (not built)
- **Authentication:** `/api/curses`, `/api/events` and `/api/reset` are unauthenticated. This is a local demo only; do not expose it.
- **Unbounded growth:** messages, decisions and executor history and records are never trimmed. Add caps.
- **Regex limits:** `matches` patterns come straight from the curse source and run on the server thread. Bound pattern length or add a timeout.
- **Shared `chat.now`:** the adapter reads a mutable clock set per message. Pass the event time into the adapter before any capability becomes asynchronous.
- **Decision history:** `GET /api/events` returns only the latest decision, so a reload loses the inspector history.
- **Malformed bodies:** a non-JSON body to `POST /api/curses` returns 422 with `line: 1`, which labels a transport error as a source error.
- **Replace-by-name:** reinstalling the same name replaces the curse and still returns 201.
- **Untested:** UI components, quota through the host, and the escalate-without-source fallback.
- Demo quota is 1000 runs per curse per hour (`DEMO_QUOTA_PER_HOUR`), far above what a burst reaches.
- Every effect is an in-memory record, so it is reversible and nothing leaves the process.

## Persistence (Azure Database for PostgreSQL)

Selected by environment. With `DATABASE_URL` **unset** (the default, and what the tests use) all state lives in memory exactly as before. With it **set**, state is saved to PostgreSQL after every change and restored on boot. The connection string is read only from the environment and is never logged or returned by the API. Azure needs TLS, so use a URL ending in `?sslmode=require`.

**Shape** (created idempotently on every boot with `CREATE ... IF NOT EXISTS`; code in `src/lib/persistence.ts`, wiring in `src/lib/runtime.ts`):

| Table | Purpose |
| --- | --- |
| `grimmod_state` | One row (`id = 'host'`) holding a JSONB snapshot: chat messages, mutes, escalations, host clock, installed curses, decisions (newest 500), the suppressed-while-muted list and the kill-switch override. Also holds the current grimoire `epoch`. Updated in place. |
| `grimmod_grimoire` | Append-only, primary key `(epoch, seq)`, one JSONB entry per row. The app only ever runs `INSERT`. An undo is a new row (a reversal entry); no entry is updated or deleted. |

The snapshot and any new grimoire rows are written in one transaction. On boot the grimoire is replayed through the engine's own audit log API, which must reproduce the stored ids exactly or persistence is reported as down.

**What a reset means.** `POST /api/reset` and `POST /api/fixtures` start a new grimoire epoch: the visible grimoire becomes empty and the snapshot is replaced, while older epochs stay in the table as history. Wiping the database yourself (dropping the two tables, or deleting the `grimmod_state` row) gives a clean start at the next boot.

**Not persisted:** the executor's rolling count history and quota usage. After a restart, counts toward a burst begin again from zero. Only one app instance should write to a database (the in-process state is the working copy).

**If the database is unreachable.** The app still boots and serves. `GET /api/health` stays HTTP 200 and adds `persistence: { mode: "postgres", status, error? }`, where `status` is `ok`, `degraded` (a write failed; requests still work from memory and the next good write catches up) or `down` (could not connect or load at boot; running in memory, re-tried at most every 15 seconds until something changes in memory, after which a restart is needed). `error` is a short code such as `ECONNREFUSED`, never the connection string. With `DATABASE_URL` unset the health body has no `persistence` field.

**How it is tested.** `test/persistence.test.ts` uses pg-mem, an in-process PostgreSQL emulator, through the same `pg` Pool interface. It is a substitute, not a real server, so it shows the SQL and restart logic work against that emulator only. The unreachable-database test uses the real `pg` driver against a closed local port.
