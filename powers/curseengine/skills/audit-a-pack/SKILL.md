---
name: audit-a-pack
description: Audit a CurseEngine rule pack or host against the three inviolables (no exfiltration, simulator never executes side effects, every action reversible). Use when asked to review, audit or sign off a pack, curse file or host directory.
---

# Audit a pack

Audit against the three inviolables in `references/inviolables.md` (a copy of `.kiro/steering/inviolables.md`; if the repo file differs, the repo file wins). Reason over source text only. Do not edit, run the apps or run the simulator while auditing. Findings are advisory; grammar changes and risk approvals stay with the owner (Pintu).

## The four audit classes

1. Undeclared capabilities (inviolable 1). Compare each action keyword in the curses (`post`, `email`, `escalate`, `mute`) with the capabilities the host adapter declares (`apps/*/src/lib/adapter.ts`). Report any action with no declared capability and any `fetch`, `http`, `net` or `process.env` data flow out of an adapter or host.
2. Actions with no undo path (inviolable 3). Check each action type has an inverse (`apps/*/src/lib/host.ts`) and that every action and reversal is written to the grimoire (`grimoire.ts`). Report any state mutation without an audit entry.
3. Simulator/live divergence (inviolable 2). The simulator must be the same executor with a recording stub adapter. Report a live adapter handed to the simulator, a second execution path, `Date.now()` or `Math.random()` in decision logic, or environment/network reads.
4. Tick-rules in non-tick hosts. Find `every` curses and check the host emits `tick` events. GrimMod emits none, so an `every` curse there never fires; Deadbeat emits one tick per day.

## Enforcement tool

Use the repo's `grimoire-auditor` custom agent (`.kiro/agents/grimoire-auditor.md`) to run the audit: it is read-only (read tools only, writes/shell/web/mcp denied) and loads the inviolables and grammar as resources. Start it with a target such as `packs/standup`, `apps/deadbeat` or `apps/grimmod`. If you cannot invoke it, say so explicitly and label any manual review as a stand-in, not the agent's output.

## Report

Verdict `CLEAN` or `FINDINGS`, files read, then one section per class. Each finding: severity (`blocker` for an inviolable breach, otherwise `warning`), `file:line`, what is wrong, which inviolable it breaks, and a fix in words. A class with no findings is "none found" plus the files read. Do not claim to have verified anything you did not read.
