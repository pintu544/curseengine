# Requirements — CurseEngine (seeded from SPEC.md)

**Pitch:** Automations you can read. Curses you can undo. One engine, two apps: GrimMod (chat moderation) and Deadbeat (invoice chasing).

## Users
Community moderator (GrimMod) · Solo freelancer (Deadbeat) · Template adopter (Skeleton Crew reader).

## Functional requirements
1. **FR1** WHEN a curse is written in the CurseEngine grammar THEN the system SHALL compile it to a typed rule graph AND SHALL reject invalid curses with a line-level error message.
2. **FR2** The system SHALL display every compiled curse as a visual rule graph (trigger → conditions → actions) readable back as the original sentence.
3. **FR3** The system SHALL execute curses against live events only through declared adapter capabilities, inside the sandbox (no eval, no undeclared side effects), enforcing a per-curse hourly action quota.
4. **FR4** The system SHALL provide a simulator that runs the identical executor over historical events with all side effects stubbed, reporting actions, targets and timestamps with zero false execution.
5. **FR5** The system SHALL record every automated action in an audit log (the grimoire): curse, event, decision path, action, timestamp.
6. **FR6** The system SHALL make every automated action reversible in one click and record the reversal in the same audit log.
7. **FR7** GrimMod SHALL provide a working demo chat (post, raid-bot burst) where a strikes-based curse visibly mutes offenders live.
8. **FR8** Deadbeat SHALL track mock invoices against a fixture clock and fire the 7/14/21-day escalation curse into an in-app outbox.
9. **FR9** Both apps SHALL run on the unmodified engine package; switching the engine off SHALL silence both.
10. **FR10** The repository SHALL carry `/.kiro` at its root, an MIT licence, and the two apps in two separate folders.

## Non-functional requirements
- **NFR1** Simulator/live decision parity: property-based tests over generated event streams, zero divergences.
- **NFR2** A curse compiles or errors in < 200 ms; simulation over ≤ 5,000 events completes in < 3 s.
- **NFR3** Zero paid services and zero required accounts for judges.
- **NFR4** Public demo stays live and unrestricted through Jan 29, 2027.

## Out of scope
Real Discord/Slack/GitHub integrations; live email to real recipients; LLM curse authoring; marketplace; multi-user accounts; any grammar construct beyond the frozen set; mobile apps.

## Locked decisions (GRILL.md, summary)
Skeleton Crew category · DSL is real (hand-written parser, no eval/Function/LLM) · grammar frozen (triggers: chat-event, timer, webhook; conditions: count-in-window, numeric threshold, text contains/matches, field equality; actions: post, mute, email, escalate) · sandbox via declared adapter capabilities + hourly quota · one executor for sim and live · fixtures only · Postgres (Neon) + Vercel, $0.
