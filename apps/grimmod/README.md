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

## Behaviour notes
- Fixture history is display only. The executor sees live events, so counts start from zero.
- A muted author's later messages are stored as muted and are not fed to the executor, so a mute and an escalation happen once, not on every further message.
- Installing or replacing a curse keeps the executor, so count history and per-curse quota usage survive. The curse list is edited in place, and the engine reads it by reference, so `packages/curse-engine/src` needed no change. Replacing a curse keeps the quota usage recorded under its name. `POST /api/reset` clears everything.
- A curse that uses an undeclared capability (for example `email`) installs fine. On each event it gets a `failed` decision record (kept in the decision log), `POST /api/events` still returns 200, and other curses still run. Such a curse runs in its own executor, which only sees events from its install onwards, so its condition counts can be lower than those of a normal curse.
- The message is always stored in chat, even when a curse fails on it.
- No host code emits `tick` events, so `every` curses install and show a graph but do not run in GrimMod yet.
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
