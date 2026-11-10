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
| `apps/grimmod` | Chat-moderation demo (placeholder until T1.5) |
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
pnpm test        # engine test suite (Vitest)
pnpm typecheck
```

## Status
Slice 1 in progress: scaffold (T1.1) and parser (T1.3) done. Executor, GrimMod UI, simulator, grimoire and Deadbeat follow — see `.kiro/specs/curse-engine/tasks.md`.

## Inviolables
No exfiltration · the simulator never executes side effects · every action is reversible. See `.kiro/steering/inviolables.md`.

## License
MIT
