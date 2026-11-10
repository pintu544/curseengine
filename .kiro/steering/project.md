---
inclusion: always
---

# CurseEngine — project conventions

- Monorepo (pnpm workspaces): `packages/curse-engine` (zero UI, zero framework
  imports), `apps/grimmod`, `apps/deadbeat`.
- TypeScript strict, ESM. Tests: Vitest. Run everything with `pnpm test`.
- Hand-written tokenizer + recursive-descent parser; errors are line-level
  (`CurseSyntaxError{line, column, message}`) and map to API `422 {line, message}`.
- Work flows spec → tasks → tests → code. Update `.kiro/specs/*/tasks.md` as tasks
  complete. Fixtures only in demos: no real services, recipients or accounts.
