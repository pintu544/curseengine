# How CurseEngine was built with Kiro

*Kiroween 2026 · Skeleton Crew · solo build by Pintu Kumar*
*Repo: https://github.com/pintu544/curseengine — the `/.kiro` folder is in the repo root, exactly as it was used.*

CurseEngine was built entirely in **Kiro Web sessions** — nine working sessions, roughly **50 of the 4,000 kiroween-26 credits**. No part of the engine or the apps was written outside Kiro; the only code-adjacent work done elsewhere was deployment packaging (zip assembly, Azure settings) and an independent adversarial QA pass after each slice, whose findings were fed back into the specs and fixed in new Kiro sessions.

## The build at a glance

| Phase | What Kiro built | Credits (account balance delta) | Test count after |
|---|---|---:|---:|
| Slice 1 build | Monorepo scaffold, tokenizer + recursive-descent parser, sandboxed executor | 5.01 cumulative | 38 |
| GrimMod shell | First app: demo chat, curse editor, rule-graph inspector, live host | +12.28 → 17.29 | — |
| Slice 1 QA fixes | Lockfile repair, ReDoS guard, bounded count history, partial-outcome records | +4.31 → 21.60 | 88 |
| Slice 2 build | Simulator, property-based tests, grimoire with undo, fixture contract | +7.17 → 28.77 | 112 |
| Slice 2 QA fixes | Wider property generators, duplicate-name semantics, honest reset disclosure | +3.85 → 32.62 | 118 |
| Slice 3 build | Deadbeat app, standup rule-pack, shared kill switch | +11.37 → 43.99 | 163 |
| Persistence | Postgres-backed state + append-only grimoire for both apps | +5.41 → 49.40 | 175 |
| Deploy output | Next.js standalone output + regression tests | +0.71 → 50.11 | 179 |

Final state: **179/179 tests green, typecheck clean, frozen-lockfile install green from a pristine clone** — verified after every slice, not just at the end.

## The eight questions

### 1. IDE, CLI, Web, Crew — what did I use, and how did they differ?

I used **Kiro Web exclusively**, on purpose. The whole build is session-shaped: one session per slice or fix pass, each starting from the spec pack and ending in a commit I could verify from a clean clone. Web sessions run server-side, so a session kept working while I reviewed the previous slice's QA report, and the session-to-commit mapping gives a clean, auditable usage trail (which matters in a competition that disqualifies entries for insufficient Kiro use).

I did not use the IDE or CLI for this project, and Crew/Bots did not fit a solo, three-slice build with a fixed deadline — there was no recurring background job for a bot to own. The honest trade-off: I gave up the IDE's inline feel for a workflow where every unit of agent work is a discrete, reviewable session.

### 2. Custom agents

I did not define custom agents in the build itself. (Slice 4 Session 1 adds a *spec* for one, `grimoire-auditor-agent`: a read-only auditor with no write or shell tools, designed in `.kiro/specs/grimoire-auditor-agent/` and not yet implemented.) The specialisation in this build lives in **steering and specs**, not agent personas: one general Kiro agent, constrained by two always-on steering files and a frozen grammar, produced more predictable results than a hand-rolled parser agent or reviewer agent would have. The reviewing role was deliberately kept *outside* the build agent — each slice was adversarially reviewed independently, and the findings (2 critical, 12 warnings across three QA passes) went back in as spec amendments. A builder grading its own homework was exactly the failure mode I wanted to avoid.

### 3. Agent hooks — what they automated

Three hooks live in `.kiro/hooks/`, each in both IDE and Web formats:

- **`resim-on-curse-save`** — the load-bearing one. Saving a curse, the fixtures file, the curse API route, or the engine's executor/simulator/grimoire re-runs `pnpm run curse:check`: the property suite (1,500 generated streams) plus the fixture simulation, which must report the canonical **"3 muted, 0 false positives."** This hook was *proven* load-bearing: we deliberately broke a fixture, the hook exited non-zero, and we reverted. Without it, an innocent-looking fixture edit could silently falsify the demo's central claim.
- **`regen-grammar-docs-on-grammar-change`** — regenerates `docs/grammar.md` from the design spec whenever the parser or the engine spec changes, so the published grammar can never drift from the implementation's source of truth.
- **`run-tests-on-spec-edit`** — runs the suite whenever a spec file is saved, so a spec edit that contradicts the code surfaces immediately instead of at the next slice gate.

### 4. Spec-driven development vs. vibe coding

The repo carries **two specs** in `.kiro/specs/` — `curse-engine` and `curse-parser` — each with `requirements.md`, `design.md`, and `tasks.md`. Every slice followed the same loop: grill the requirements, write the spec, get explicit approval, implement task by task, verify from a pristine clone, run adversarial QA, amend the spec with the findings, fix in a new session.

Three moments show what the spec bought:

- **Grammar disputes were settled on paper, not in code.** The examples and the grammar text disagreed in three places (grouping inside `count(...)`, `where` on timers, duration units). All three were resolved and written into `design.md` before the parser was finished — the parser never had to guess.
- **Seven executor-semantics questions** (what counts as `flagged`, how quota is counted, what a missing field means…) were disclosed by Kiro during the executor session, ratified in one pass, and pinned in the design. Every one of them would have been a coin-flip bug in vibe-coded code.
- **QA findings became spec text.** "Refused curses consume no quota," "fixture refresh is a full demo reset and must say so," "the grimoire API returns the latest 50 suppressed events plus a total" — all started as QA warnings and are now documented, test-pinned behaviour.

### 5. Steering docs — and the strategy that made the biggest difference

Two always-on steering files:

- **`.kiro/steering/project.md`** — conventions: monorepo layout, TypeScript strict, the engine never imports from apps, fixtures only (no real services or recipients), spec → tasks → tests → code.
- **`.kiro/steering/inviolables.md`** — the three inviolables: **no exfiltration** (actions run only through adapter capabilities the host declared), **the simulator never executes side effects** (same executor, recording stub — never a second execution path), **every action is reversible** (each action type ships an inverse, all of it written to the grimoire). Plus: no `eval`, no `Function`, no LLM in parsing or execution; the grammar is frozen unless the spec changes first.

The biggest difference came from the **inviolables file**, because it converts the product's safety promises into constraints the agent checks *while* writing code, not in review. Twice it visibly shaped the output: the simulator was implemented as the same executor with a recording adapter (inviolable 2 — the easier path, a parallel dry-run code path, was never proposed), and Deadbeat's mail adapter writes only to an in-app outbox (inviolable 1 — no code path can send real email).

### 6. MCP

Honest answer: **no MCP servers were used in the Kiro sessions.** The stack (TypeScript, Next.js, Vitest, fast-check) is squarely inside the model's reliable knowledge, and the project's context problem was already solved by the spec pack and steering — the failure MCP usually fixes (hallucinated APIs, stale docs) never had room to appear, because the grammar and semantics were pinned in our own design docs before code existed. If I extend CurseEngine after the hackathon, the first MCP server I would add is a docs server for the Postgres driver and Next.js standalone output, because deploy-time behaviour — not language syntax — is where this build actually met surprises.

**Update, Slice 4 Session 1 (Context7 MCP): configured and committed, but NOT used.** `.kiro/settings/mcp.json` now declares a `context7` server (`https://mcp.context7.com/mcp`) whose key is passed only as the environment reference `${CONTEXT7_API_KEY}` (never a literal). The plan was to consult Context7 for `pg` (node-postgres) and Next.js behaviour while hardening persistence. In that session's sandbox it could not be used, and I am not claiming any lookup happened. The exact blockers observed:

- Kiro Power `context7` activated with `Server: context7 (No tools available)`; calling `resolve-library-id` returned `Tool 'resolve-library-id' does not exist on server 'power-context7-context7'.`
- `CONTEXT7_API_KEY` was not set in the sandbox environment.
- Direct egress to the endpoint was refused: `curl: (7) CONNECT tunnel failed, response 403` for `https://mcp.context7.com/mcp`.

So no failure is credited to MCP. The persistence work was written from the existing code patterns and pinned by tests; the one place a docs lookup would plausibly have helped (what `pg-mem` supports) was instead settled by running the tests, which found that pg-mem has no advisory locks (shimmed in tests only) and cannot re-create a dropped table or roll back DDL (the tests assert only what the emulator can show). The only external documentation read in that session was Kiro's own [MCP configuration](https://kiro.dev/docs/mcp/configuration/) and [custom-agent configuration reference](https://kiro.dev/docs/custom-agents/configuration-reference/) pages, fetched as plain web pages, which is not Context7. Enabling the server in the Kiro Web settings UI was not possible from inside the sandbox session.

### 7. Property-based testing — what it caught that unit tests missed

PBT (fast-check) is the centrepiece of the verification story, aimed at the three claims the whole product stands on:

- **Simulator/live parity:** 1,500 generated event streams run through both the live executor path and the simulator — **zero divergences**, asserted as a count inside the test.
- **Dry-run purity:** for any generated stream, simulating leaves live state byte-identical (300 runs).
- **Undo restoration and audit completeness/order:** for any executed action sequence, undo restores the prior state and the grimoire is complete and ordered (300 runs each).

On its **first** parity run, PBT shrank a real counterexample: the simulator suppressed a backdated message that the live side let through. The bug turned out to be in the test's own live *model* — it kept only the latest mute per author while the real chat state stacks mutes — but that is precisely the point: a hand-written unit test would have encoded the same wrong assumption and passed. The property disagreed with both implementations' shared assumption and forced the mute-stacking semantics into the open, where they were documented and regression-tested. In the Slice 2 fix pass the generators were widened further (tick and webhook curses, email actions, invalid `matches` patterns, wrong-typed fields, random capability sets) with reach assertions — no new divergence appeared.

PBT also shaped the engine defensively elsewhere: an adversarial QA pass found a ReDoS hole (a crafted `matches` pattern could hang an event for ~33 seconds); the fix — a pattern validator plus a subject cap — is itself pinned by tests, and the property generators now include hostile patterns.

### 8. Kiro Powers

I did not use Kiro Powers. The build's integrations were hooks and the repo's own tooling; no third-party service needed steering-plus-MCP bundling (the one external system, Azure Database for PostgreSQL, is reached through a plain connection string behind the apps' repository interface). Rather than bolt on a Power for the checklist, the time went into the hook suite and the property tests, which are the parts of this project a Power would have had to beat to earn its place.

## What the loop looked like, end to end

Grill → spec (2 specs, 6 documents) → approval → Kiro Web session per slice → pristine-clone verification (frozen install, full suite, typecheck, engine-diff check) → independent adversarial QA → spec amendments → fix session → re-verification. Three slices, three QA passes, zero engine changes after the Slice 2 baseline — the two apps and the standup pack were added without touching `packages/curse-engine`, which is the Skeleton Crew claim, and it is mechanically checkable in the git history (the Slice 3 and persistence diffs contain zero files under `packages/curse-engine`).

The total Kiro spend — about 50 credits of the 4,000-credit pack — is itself a finding: with the spec carrying the decisions, the agent's job was execution, and execution is cheap. The expensive part of this build was deciding, in writing, exactly what the software should do.

## Slice 4, Session 1: specs, persistence hardening, MCP attempt

Two new specs were written before any code, in the same three-file style: `.kiro/specs/grimoire-persistence-hardening/` (implemented in this session) and `.kiro/specs/grimoire-auditor-agent/` (spec only; implementation is the next session). The hardening covered both apps: a `<app>_meta` table with a numbered, idempotent boot migration under an advisory lock (`SCHEMA_TOO_NEW` and `SCHEMA_CORRUPT` refuse rather than rewrite); GrimMod's persisted `suppressed` list capped at the latest 200 with the exact total kept (Slice-3 QA warning W1); and `/api/health` gaining `persistence.schemaVersion`. Zero files under `packages/curse-engine` changed. The Context7 MCP outcome is in answer 6 above: configured, blocked, not used.
