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
- Installing a curse rebuilds the executor, so its in-memory count history restarts. Chat history stays.
- Demo quota is 1000 runs per curse per hour (`DEMO_QUOTA_PER_HOUR`), far above what a burst reaches.
- Every effect is an in-memory record, so it is reversible and nothing leaves the process.
