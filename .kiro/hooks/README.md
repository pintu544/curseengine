# Hooks

- `*.kiro.hook` — Kiro IDE format.
- `*.json` — Kiro Web / agent (v1 `hooks` array) format; same behaviour.

| Hook | Trigger | Action |
|---|---|---|
| run-tests-on-spec-edit | save `.kiro/specs/**/*.md` | `pnpm test` |
| regen-grammar-docs | save parser/ast/tokenizer | `pnpm --filter @curseengine/engine run docs:grammar` (writes `docs/grammar.md` from the design spec) |
