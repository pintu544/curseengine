# Tasks — Grimoire auditor agent

Status: SPEC ONLY. Every task below is for the NEXT session. None is started.

- [ ] 1. Resolve the two open questions in `design.md` (tool category coverage; Markdown vs JSON agent format on Kiro Web). _R1, R16_
- [ ] 2. Create `.kiro/agents/grimoire-auditor.md` exactly per `design.md` (front matter + system prompt). _R1-R6, R11-R14_
- [ ] 3. Add the mechanical agent-config test (front matter parse; read-only tools; deny rules; exact resources; no mcpServers/hooks; resource paths exist). _R1-R5_
- [ ] 4. Build a seeded negative fixture (undeclared `email` in a GrimMod-style host; `every` curse in GrimMod; an action with no inverse) and run the agent against it and against `packs/standup`; record the reports. _R7-R10, R12_
- [ ] 5. Extend `docs/KIRO-USAGE.md` (custom agents answer) with what the auditor found, honestly, including false negatives. _R13_
- [ ] 6. `pnpm -r test` and `pnpm -r typecheck` green; `git diff --stat` shows nothing under `packages/curse-engine`. _R15_
