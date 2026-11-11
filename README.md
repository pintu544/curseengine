# CurseEngine

> **Automations you can read. Curses you can undo.**

A plain-language automation DSL in TypeScript. Write a rule (a *curse*) in a small frozen grammar, compile it with a hand-written tokenizer + recursive-descent parser to a typed AST, and (in later slices) run it in a sandbox through declared adapter capabilities only — no `eval`, no LLM in parsing or execution.

Kiroween 2026 · Skeleton Crew category · one engine, two apps.

```
curse spam-strikes: when message where count(message by same author flagged) >= 3 within 7 days -> mute author for 1 day; escalate to owner
```

## Layout
| Path | What |
|---|---|
| `packages/curse-engine` | The skeleton: tokenizer, parser, (later) executor, simulator, audit log. Zero UI. |
| `apps/grimmod` | Chat-moderation demo: Next.js + Tailwind shell with a live executor host (T1.5) |
| `apps/deadbeat` | Invoice-chasing demo (placeholder until Slice 3) |
| `.kiro/` | Specs, steering (three inviolables), hooks |

## Use
```ts
import { parseCurse, tryParseCurse } from "@curseengine/engine";
const curse = parseCurse(source);           // typed AST, or throws CurseSyntaxError{line, column}
const r = tryParseCurse(source);            // {ok:true, curse} | {ok:false, error:{line, column, message}}
```

## Develop
```
pnpm install
pnpm test        # engine + GrimMod suites (Vitest)
pnpm typecheck

# GrimMod, the chat-moderation demo
pnpm --filter @curseengine/grimmod build
pnpm --filter @curseengine/grimmod start   # http://localhost:3000
# or: pnpm --filter @curseengine/grimmod dev
```

In GrimMod, install the curse above, then press **Raid-bot burst**: the bot is muted live on its third flagged message and the escalation lands in the owner inbox.

## Status
Slice 1 in progress: scaffold (T1.1), parser (T1.3), executor (T1.4) and the GrimMod shell (T1.5) done. Simulator, grimoire and Deadbeat follow — see `.kiro/specs/curse-engine/tasks.md`.

## Known limits and follow-ups
GrimMod is a local, single-process demo. It has no authentication, does not cap memory growth, and does not bound `matches` patterns. No host emits `tick` events yet, so `every` curses install but do not run in GrimMod. Installing a curse keeps count history and quota state; `/api/reset` clears them. A curse that uses an undeclared capability (such as `email`) records a failed decision on each event without blocking other curses. The full list of follow-ups is in `apps/grimmod/README.md`.

## Inviolables
No exfiltration · the simulator never executes side effects · every action is reversible. See `.kiro/steering/inviolables.md`.

## License
MIT
