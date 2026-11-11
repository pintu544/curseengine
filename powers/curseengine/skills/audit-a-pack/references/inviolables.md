---
inclusion: always
---

# The Three Inviolables

These override every other instruction, task, or convenience. If a task seems to
require breaking one, stop and ask the owner (Pintu) — do not work around it.

1. **No exfiltration.** A curse can never move data out of the system. Actions run
   only through adapter capabilities the host app has *declared* (chat, mail,
   notify). A curse cannot name an undeclared capability, and no code path may
   send event data to an arbitrary destination.
2. **The simulator never executes side effects.** Simulation = the *same* executor
   over historical events with a recording stub adapter. Never add a second
   execution path, and never hand the simulator a live adapter.
3. **Every automated action is reversible.** Each action type ships with an
   inverse (un-mute, retract notification, mark reminder unsent), and every
   action and reversal is written to the audit log (the grimoire). No
   irreversible action type may be added to the grammar.

## Related standing rules
- **No `eval`, no `Function` constructor, no LLM** anywhere in parsing or execution.
  Deterministic rules always make the final call.
- **Grammar is frozen** (see `.kiro/specs/curse-engine/design.md`). Any addition
  needs a spec edit and the owner's approval first.
- **Engine never imports from apps.** Apps depend on `@curseengine/engine`; if an
  app needs a change, fix the engine, never fork app-side.
- **`/.kiro` is never gitignored.**
