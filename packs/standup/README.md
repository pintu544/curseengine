# Standup digest pack

A third, deliberately tiny application of the unmodified CurseEngine. It is a rule-pack, not an app: three `.curse` files and one test that dry-runs them through the engine's `simulate()` over a small fixture history and prints the report.

## What it is
A team standup and digest bot. Compared with the two apps:

| | GrimMod | Deadbeat | Standup pack |
|---|---|---|---|
| Rhythm | real-time | scheduled | scheduled |
| Audience | public chat | external clients | team-internal |
| Nature | safety-critical, human in the loop | money-adjacent, tone-critical | informational |
| Events | `message` | `tick` | `standup` |
| Actions | mute, escalate | email, escalate | `post`, `escalate` only |

New vocabulary (`standup`, `member`, `update`), new rules and a new action mix, with zero engine changes. The engine is the same `packages/curse-engine` that GrimMod and Deadbeat use.

## The curses
| File | Rule |
|---|---|
| `curses/shipped-digest.curse` | A standup update that contains "shipped" is posted to the `team-digest` channel |
| `curses/blocker-callout.curse` | A flagged update that contains "blocked" is posted to `team-standup` and escalated to the owner |
| `curses/blocked-three-days.curse` | Three flagged updates from the same member within 7 days escalate to the owner |

## Run the dry run
```
pnpm --filter @curseengine/pack-standup test
```
The test parses every file in `curses/`, simulates them over eight standup updates from three team members, prints each intended action and a summary line, and asserts the result. The simulator uses a recording stub, so nothing is ever posted or escalated.

## The resim hook
These `*.curse` files are real files for the trigger in `.kiro/hooks/resim-on-curse-save.json`, whose matcher includes `\.curse$`. Saving one runs `pnpm run curse:check`, which includes this pack's dry run.
