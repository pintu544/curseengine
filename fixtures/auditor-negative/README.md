# Seeded negative fixture (spec: grimoire-auditor-agent, task 4)

A GrimMod-style host pack in which every defect below is PLANTED, so the
auditor's true-positive rate on known-bad input can be measured:

1. `prize-patrol` uses the `email` action — the fixture host does NOT declare
   the email capability (undeclared capability).
2. `daily-digest` uses an `every` trigger — the fixture host NEVER sends tick
   events, so this curse can never fire (tick-rule in a non-tick host).
3. `spam-hammer` escalates — the fixture host's inverse registry has NO
   inverse for `escalate` (action with no undo path).

The curses are grammar-valid on purpose: the defects are semantic, exactly
the classes the grimoire-auditor exists to catch. A correct audit reports
all three, and reports nothing else in this fixture.
