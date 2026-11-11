# Design — CurseEngine (seeded from DESIGN.md)

## Architecture
pnpm monorepo, one dependency direction (apps → engine, never the reverse):
- `packages/curse-engine` — tokenizer, recursive-descent parser (typed AST), sandboxed executor, simulator, audit/undo log, adapter interfaces. Zero UI.
- `apps/grimmod` — Next.js + Tailwind: demo chat, editor, rule-graph inspector, simulator report, grimoire.
- `apps/deadbeat` — Next.js + Tailwind: invoices, escalation curse, outbox, grimoire.
- Postgres (Neon) per app; engine is storage-agnostic behind a repository interface.
- `/.kiro` at root: specs, steering (three inviolables), hooks.

Data flow: event enters via adapter → executor matches compiled curses → conditions evaluated over the event store → actions issued through adapter → every decision lands in the audit log. The simulator swaps the event source for fixture history and the adapter for a recording stub; nothing else changes.

## Frozen grammar
```
curse      := "curse" name ":" trigger "->" action (";" action)*
trigger    := "when" event ["where" conditions]
            | "every" interval ["where" conditions] | "on webhook" path
conditions := condition (("and" | "or") condition)*
condition  := count-cond | compare | text-cond
count-cond := "count(" event ["by same" field] ["flagged"] ")" ">=" number "within" duration
compare    := field (">"|">="|"<"|"<="|"=") value
text-cond  := field "contains" string | field "matches" string
action     := "mute" target "for" duration | "post" string "to" channel
            | "email" template "to" field | "escalate" "to owner"
```
GrimMod: `curse spam-strikes: when message where count(message by same author flagged) >= 3 within 7 days -> mute author for 1 day; escalate to owner`

Deadbeat: `curse late-payers: every 1 day where days_overdue >= 7 -> email polite-nudge to client` (tiers: three curses or one tiered curse, decided at Slice 3 kickoff).

### Parser interpretations (recorded in Slice 1; ratified by the owner on 11 Nov 2026)
The grammar text and its own examples differ in three places; the examples are authoritative, so the parser accepts exactly these readings and nothing broader:
1. `count(` event [`by same` field] [`flagged`] `)`: the GrimMod example's `by same author flagged` modifiers inside `count(...)`.
2. `every` interval may be followed by an optional `where` conditions clause (Deadbeat example).
3. `duration` := positive number + unit in {minute(s), hour(s), day(s), week(s)}; grammar left units unspecified.
Also: `and`/`or` chains are stored flat in source order. The grammar defines no precedence. **Resolved (approved by Pintu, 11 Nov):** the executor evaluates `and`/`or` chains FLAT, left to right in source order, with no operator precedence (`a or b and c` = `(a or b) and c`). Names/fields/targets are words (`[A-Za-z_][A-Za-z0-9_.-]*`); grammar keywords are reserved.

### Grammar notes (ratified 11 Nov 2026)
- `count(...)` accepts an optional `by same <field>` grouping and an optional trailing `flagged`, in that order.
- `every <interval>` accepts an optional `where` clause.
- Duration units are minutes, hours, days and weeks (singular or plural).
- `and`/`or` condition chains evaluate flat, in source order, with no precedence.

## Executor semantics (ratified 11 Nov 2026, owner)
These describe how the executor in `packages/curse-engine/src/executor.ts` behaves; this section records them as the specification. Where a rule depends on the host (for example ticks), the host must supply that behaviour: the executor does not.
1. **Tick events and triggers.** A host that wants `every` curses to run must emit `tick` events, one per subject, carrying fields such as `days_overdue` and `client`. The executor does not generate ticks. A tick matches an `every` curse when its `interval`, converted to milliseconds, equals the curse's interval in milliseconds (so `60 minutes` and `1 hour` match). Ticks are not added to the event history. A `webhook` event matches an `on webhook` curse when its `path` field equals the curse's path exactly. **GrimMod does not emit ticks yet**, so `every` curses install and appear in the rule graph but never run there; Deadbeat is the first host that will emit them.
2. **Flagged.** "Flagged" means the event's `flagged` property is exactly `true`. Any other value, or no value, is not flagged.
3. **Flat fields bag.** Events carry a flat `fields` bag. A missing field makes the condition false, and the decision record notes the missing field.
4. **Targets.** A target is any field name: the executor looks up the word the curse names in the event's `fields` (`mute author` reads `author`, `email <template> to client` reads `client`, and `mute reporter` would read `reporter`). If the field is missing, the action is skipped and the reason is recorded.
5. **Count.** `count` ranges over the executor's own in-memory event history (which a host keeps only by keeping the same executor alive; GrimMod does so across curse installs and clears it on reset), over the window (at - window, at], including the current event. With `by same <field>`, only events whose field equals the current event's value are counted; if the current event lacks the field, the count is 0 and the record notes it.
6. **Quota.** The quota counts curse runs (not actions) per curse over a rolling 60 minutes. The limit is supplied by the host through `ExecutorOptions.quotaPerHour`; the executor applies it to each curse's own run count. A run that exceeds it is recorded as `skipped-quota`.
7. **Text and ordering.** `contains` and `matches` are case-sensitive. `matches` builds a JavaScript `RegExp`, and an invalid pattern evaluates to false (noted in the record). Ordering comparisons (`>`, `>=`, `<`, `<=`) on non-numeric values are false.

## Data model
`curses`(id, app, name, source_text, ast jsonb, enabled, created_at) · `events`(id, app, type, actor, payload, occurred_at) · `audit_entries`(id, curse_id, event_id, decision_path, action, target, status applied|simulated|reversed, reversal_of, created_at) · Deadbeat: `invoices`, `outbox`.

## API contracts (per app)
`POST /api/curses` {source} → 201 {id, graph} | 422 {line, message} · `GET /api/curses/:id/graph` · `POST /api/curses/:id/simulate` {historyId} · `POST /api/events` · `GET /api/grimoire` · `POST /api/grimoire/:id/undo` · `GET /api/health`.

## Key decisions
Hand-written parser (line-level errors; rejected PEG/LLM) · one executor two modes · engine as workspace package, apps thin · Postgres over SQLite.

## Risks
Grammar creep → frozen · simulator drift → single code path + property tests · thin second app → Deadbeat is a full slice · Kiro depth → real specs/steering/hooks from day one.
