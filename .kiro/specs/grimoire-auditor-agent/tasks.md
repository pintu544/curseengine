# Tasks — Grimoire auditor agent

Status (Session 2, updated after the audit run): tasks 1, 2, 3 done. Task 4 is partly done: the agent's brief was run (via a stand-in, see the report) against the real apps and `packs/standup`; the seeded negative fixture was NOT built. Task 5 done for what ran. Task 6 verified at the end of the session.

- [x] 1. Resolve the two open questions in `design.md` (tool category coverage; Markdown vs JSON agent format on Kiro Web). _R1, R16_
- [x] 2. Create `.kiro/agents/grimoire-auditor.md` exactly per `design.md` (front matter + system prompt). _R1-R6, R11-R14_
- [x] 3. Add the mechanical agent-config test (front matter parse; read-only tools; deny rules; exact resources; no mcpServers/hooks; resource paths exist). _R1-R5_
- [x] 4. Build a seeded negative fixture (undeclared `email` in a GrimMod-style host; `every` curse in GrimMod; an action with no inverse) and run the agent against it and against `packs/standup`; record the reports. _R7-R10, R12_ — **Done:** seeded fixture built (`fixtures/auditor-negative/`), named agent run on CLI 2026-11-11, 3/3 planted defects caught, report at `docs/audits/grimoire-auditor-cli-2026-11-11.md`.
- [x] 5. Extend `docs/KIRO-USAGE.md` (custom agents answer) with what the auditor found, honestly, including false negatives. _R13_ — done in the Session 2 audit section; no false negatives were established because there was no seeded fixture.
- [x] 6. `pnpm -r test` and `pnpm -r typecheck` green; `git diff --stat` shows nothing under `packages/curse-engine`. _R15_
