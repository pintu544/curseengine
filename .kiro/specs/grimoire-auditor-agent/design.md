# Design — Grimoire auditor agent

## File: `.kiro/agents/grimoire-auditor.md` (to be created next session)

Front matter (target shape):

```yaml
---
name: grimoire-auditor
description: Read-only auditor for CurseEngine rule packs. Finds undeclared capabilities, actions without an undo path, simulator/live divergence risks and tick-rules in non-tick hosts. Cannot write or run anything.
tools: ["read"]
includeMcpJson: false
includePowers: false
resources:
  - file://.kiro/steering/inviolables.md
  - file://docs/grammar.md
permissions:
  rules:
    - capability: fs_read
      match: ["**"]
      effect: allow
    - capability: fs_write
      match: ["**"]
      effect: deny
    - capability: shell
      match: ["*"]
      effect: deny
    - capability: web_fetch
      match: ["*"]
      effect: deny
    - capability: web_search
      match: ["*"]
      effect: deny
    - capability: mcp
      match: ["*"]
      effect: deny
welcomeMessage: "Point me at a pack or host directory and I will audit it. I can read, but I cannot change anything."
---
```

Body = the system prompt: role, the three inviolables (one line each; "the files win"), the four audit classes with where to look (below), the report format from requirements 11-13, and the rule "read only what you cite".

Defence in depth: the tool list omits write and shell, and the permission rules deny them, so removing either layer alone does not make the agent writable. `includeMcpJson: false` keeps the Context7 server (and its `${CONTEXT7_API_KEY}` header) out of the auditor.

## Where each audit class looks

| Class | Reads | Signal |
|---|---|---|
| Undeclared capability | curse source (`packs/**`, `apps/*/src/lib/fixtures.ts`), `apps/*/src/lib/adapter.ts` (declared capability set), `docs/grammar.md` | action keyword with no matching declared capability; any `fetch`, `http`, `net`, `process.env` data flow out of an adapter |
| No undo path | `apps/*/src/lib/host.ts` (`chatInverse`, `mailInverse`), `grimoire.ts`, adapter | action type with no inverse; state mutation not preceded by a `recordDecision` / grimoire write |
| Simulator/live divergence | `apps/*/src/lib/host.ts`, simulate API routes (`app/api/curses/[id]/simulate/route.ts`), `runtime.ts` | simulator handed the live adapter; `Date.now()`/`Math.random()` in decision logic; behaviour keyed on unpersisted state |
| Tick rule, non-tick host | curse `every` triggers; host intake (`host.ts`, `app/api/events/route.ts`) | `every` curse in a host with no `tick` emitter |

## Report skeleton

```
# Grimoire audit: <target>
**Verdict**: CLEAN | FINDINGS
Files read: ...
## 1. Undeclared capabilities   (none found | findings)
## 2. Actions with no undo path
## 3. Simulator / live divergence risk
## 4. Tick-rules in non-tick hosts
```

## Verification approach (for the implementation session)

The agent cannot be unit-tested like code, so the tasks pin it with checks that ARE mechanical: (a) a Vitest test that parses `.kiro/agents/grimoire-auditor.md` front matter (using a tiny hand-written parser or a regex over the `---` block, no new dependency) and asserts: `tools` is exactly `["read"]`, no `write`/`shell`/`web`/`*` anywhere, the deny rules for `fs_write`, `shell`, `web_fetch`, `web_search`, `mcp` exist, `resources` is exactly the two files, no `mcpServers`, no `hooks`; (b) all `resources` paths exist; (c) a seeded negative fixture pack (an `email` action in a GrimMod-style host, an `every` curse in GrimMod) that a manual run of the agent must flag, recorded in the usage doc. (a) and (b) belong in a root-level or `apps/grimmod` test that does not touch the engine.

## Open questions (resolve before implementation)

- Whether `read` covers grep and glob in the target Kiro surface (the reference lists the `read` category; confirm in the Web agent config).
- Whether the Kiro Web surface honours the Markdown agent format or needs the JSON twin (hooks needed both formats; see `.kiro/hooks/README.md`). If JSON is needed, generate it from the same front matter and add a drift test.
