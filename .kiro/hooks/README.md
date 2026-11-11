# Hooks

- `*.kiro.hook` — Kiro IDE format.
- `*.json` — Kiro Web / agent (v1 `hooks` array) format; same behaviour.

| Hook | Trigger | Action |
|---|---|---|
| run-tests-on-spec-edit | save `.kiro/specs/**/*.md` | `pnpm test` |
| regen-grammar-docs | save parser/ast/tokenizer or `.kiro/specs/curse-engine/design.md` | `pnpm --filter @curseengine/engine run docs:grammar` (writes `docs/grammar.md` from the design spec) |
| resim-on-curse-save | save `*.curse`, `apps/grimmod/src/lib/fixtures.ts` (where the example curse lives), `apps/grimmod/app/api/curses/route.ts` (curse save/install), or engine `executor.ts` / `simulator.ts` / `grimoire.ts` | `pnpm run curse:check` = engine `test:properties` (parity over 1,500 generated streams + invariants a/b/c + simulator tests) then GrimMod `sim:fixtures` (fixture-history simulation must give "3 muted, 0 false positives", fixture idempotency, grimoire storyline). Non-zero exit = failure surfaced. |
