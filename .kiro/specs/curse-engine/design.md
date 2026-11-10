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
            | "every" interval | "on webhook" path
conditions := condition (("and" | "or") condition)*
condition  := count-cond | compare | text-cond
count-cond := "count(" event ")" ">=" number "within" duration
compare    := field (">"|">="|"<"|"<="|"=") value
text-cond  := field "contains" string | field "matches" string
action     := "mute" target "for" duration | "post" string "to" channel
            | "email" template "to" field | "escalate" "to owner"
```
GrimMod: `curse spam-strikes: when message where count(message by same author flagged) >= 3 within 7 days -> mute author for 1 day; escalate to owner`

Deadbeat: `curse late-payers: every 1 day where days_overdue >= 7 -> email polite-nudge to client` (tiers: three curses or one tiered curse, decided at Slice 3 kickoff).

### Parser interpretations (recorded in Slice 1; flagged for owner confirmation)
The grammar text and its own examples differ in three places; the examples are authoritative, so the parser accepts exactly these readings and nothing broader:
1. `count(` event [`by same` field] [`flagged`] `)` — the GrimMod example's `by same author flagged` modifiers inside `count(...)`.
2. `every` interval may be followed by an optional `where` conditions clause (Deadbeat example).
3. `duration` := positive number + unit in {minute(s), hour(s), day(s), week(s)}; grammar left units unspecified.
Also: `and`/`or` chains are stored flat in source order — precedence is not defined by the grammar and is left to the executor task (T1.4). **Resolved (approved by Pintu, 11 Nov):** the executor evaluates `and`/`or` chains FLAT, left to right in source order, with no operator precedence (`a or b and c` = `(a or b) and c`). Names/fields/targets are words (`[A-Za-z_][A-Za-z0-9_.-]*`); grammar keywords are reserved.

## Data model
`curses`(id, app, name, source_text, ast jsonb, enabled, created_at) · `events`(id, app, type, actor, payload, occurred_at) · `audit_entries`(id, curse_id, event_id, decision_path, action, target, status applied|simulated|reversed, reversal_of, created_at) · Deadbeat: `invoices`, `outbox`.

## API contracts (per app)
`POST /api/curses` {source} → 201 {id, graph} | 422 {line, message} · `GET /api/curses/:id/graph` · `POST /api/curses/:id/simulate` {historyId} · `POST /api/events` · `GET /api/grimoire` · `POST /api/grimoire/:id/undo` · `GET /api/health`.

## Key decisions
Hand-written parser (line-level errors; rejected PEG/LLM) · one executor two modes · engine as workspace package, apps thin · Postgres over SQLite.

## Risks
Grammar creep → frozen · simulator drift → single code path + property tests · thin second app → Deadbeat is a full slice · Kiro depth → real specs/steering/hooks from day one.
