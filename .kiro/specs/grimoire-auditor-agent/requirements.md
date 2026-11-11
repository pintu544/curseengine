# Requirements — Grimoire auditor agent (Slice 4; SPEC ONLY this session)

A read-only custom Kiro agent, `.kiro/agents/grimoire-auditor.md`, that audits a rule pack (a set of curses plus the host that runs them) against the project's inviolables. **Nothing in this spec is implemented in Session 1**: no agent file is created, no tests, no code. Implementation is the next session, and it starts from `tasks.md` here.

An auditor is a reviewer kept outside the builder (see `docs/KIRO-USAGE.md`, question 2: "a builder grading its own homework" is the failure mode). Its power comes from being unable to change anything.

## Capability and trust

1. The agent SHALL be read-only. Its `tools` list SHALL contain only read-category tools (`read`, which covers file read, grep and glob). It SHALL NOT include `write`, `shell`, `web`, `subagent`, `@mcp`, `@builtin`, or `*`.
2. Its `permissions.rules` SHALL allow `fs_read` and SHALL explicitly `deny` `fs_write`, `shell`, `web_fetch`, `web_search` and `mcp` (deny wins in every scope, so a later edit that widens `tools` still cannot grant these).
3. The agent SHALL NOT define `mcpServers`, SHALL set `includeMcpJson: false` and `includePowers: false` (the Context7 server in `.kiro/settings/mcp.json` is for build sessions, not for the auditor), and SHALL NOT define `hooks`.
4. The agent SHALL NOT execute rules, run the simulator, start the apps or run tests. It reasons over source text only. (Re-running the simulator is a build-session job; it is already covered by the `resim-on-curse-save` hook.)

## Context (resources)

5. `resources` SHALL include exactly: `file://.kiro/steering/inviolables.md` and `file://docs/grammar.md`. Both are small, so the 32-file / 100,000-character load limits are not at risk. Additional files are read on demand by the agent, not preloaded.
6. The system prompt SHALL restate the three inviolables in one line each, and tell the agent that the files above win if the prompt and the files ever differ.

## What it audits

Input: a path to a pack directory, a `.curse` file, or a host directory (for example `packs/standup`, `apps/deadbeat`). For each curse it reads the source and the host's adapter and host code. It reports four classes of finding:

7. **Undeclared capabilities** (inviolable 1). WHEN a curse's action names a capability (`post`, `email`, `escalate`, `mute`, ...) that the target host's adapter does not declare THEN report it, citing the curse line and the adapter's declared capability list. Also report any host code path that sends event data anywhere other than a declared capability.
8. **Actions with no undo path** (inviolable 3). WHEN an action type used by a curse has no inverse registered in the host (`chatInverse`, `mailInverse` or equivalent), or a mutation is not written to the grimoire THEN report it. Check that every action and reversal is an audit entry.
9. **Simulator / live divergence risk** (inviolable 2). Report any host code path that gives the simulator a live adapter, adds a second execution path, or reads state the recording stub cannot reproduce (wall-clock time instead of event time, randomness, environment reads, network). Report rules whose result depends on state that is not persisted or replayed (for example executor count history across a restart) when it could make a simulated verdict differ from the live one.
10. **Tick-rules in non-tick hosts.** WHEN a curse uses an `every` timer trigger and the host never emits `tick` events (GrimMod emits none; Deadbeat is the tick host) THEN report that the curse can never fire there.

## Output

11. The report SHALL be Markdown with a verdict line `**Verdict**: CLEAN` or `**Verdict**: FINDINGS`, then findings grouped by the four classes. Each finding SHALL have: severity (`blocker` for an inviolable breach, `warning` otherwise), `file:line`, what is wrong, why it matters in terms of the inviolable, and a suggested fix described in words (the agent never edits).
12. A class with no findings SHALL be listed as "none found" with the files that were read, so an empty result is evidence rather than silence.
13. The agent SHALL NOT claim to have verified anything it did not read, and SHALL say so when a file it needed was missing.
14. The agent output SHALL be advisory. Owner decisions (grammar changes, approving a risk) stay with Pintu per `inviolables.md`.

## Constraints

15. ZERO changes under `packages/curse-engine`. The agent file lives in `.kiro/agents/` only. No eval, no Function, no LLM inside parsing or execution is unaffected, since the auditor is a development-time reviewer and is not shipped in the runtime.
16. Format: Markdown with YAML front matter (name, description, tools, permissions, resources, includeMcpJson, includePowers, welcomeMessage) and the system prompt as the body, per Kiro's custom-agent configuration reference (IDE 1.0 / CLI V3).
