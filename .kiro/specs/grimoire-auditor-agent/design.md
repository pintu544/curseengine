# Design — Grimoire auditor agent

## File: `.kiro/agents/grimoire-auditor.md`

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

## Open questions (resolved in Session 2)

- **Does `read` cover grep and glob?** NOT verified. Kiro's configuration reference (fetched in Session 2) lists `read` as a category tag and defers category membership to a separate "Built-in tools" page, which I could not retrieve (404 at the guessed URLs). Decision: keep `tools: ["read"]` as the spec says. It is read-only whatever it covers; the risk is only that the agent has fewer search tools than hoped, in which case it can still read files directly. To confirm, open Agent Config in the Kiro surface you use and inspect the tools the `read` category expands to.
- **Markdown or JSON twin?** Verified from the same reference: an agent config "can be a JSON file or a Markdown file with YAML front matter", and the Markdown example lives at `.kiro/agents/<name>.md`. That page documents IDE 1.0 and CLI V3. NOT verified: whether the Kiro Web surface loads `.kiro/agents/*.md` (hooks needed both formats there). Decision: ship Markdown only, no JSON twin and no drift test, because inventing an unverified twin would add an untested second source of truth. If the owner finds Web ignores the Markdown agent, generate the JSON from the same front matter (system prompt into `prompt`) and add a drift test then.
