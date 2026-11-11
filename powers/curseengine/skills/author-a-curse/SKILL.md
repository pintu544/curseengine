---
name: author-a-curse
description: Write a valid CurseEngine curse (a one-line automation rule such as muting an author after flagged messages, or emailing late-paying clients). Use when asked to create, fix or explain a curse for GrimMod or Deadbeat.
---

# Author a curse

A curse is one line in a frozen grammar. Never invent syntax: if the grammar below cannot express the request, say so and ask the owner (Pintu) instead of extending it.

The full frozen grammar, parser interpretations and executor semantics are in `references/grammar.md`. Read it before writing a curse.

## Grammar (summary; the reference file wins)

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

Durations are whole numbers 1 to 10000 plus minute(s), hour(s), day(s) or week(s). No fractions (`1.5 days` is a parse error). Names, fields and targets match `[A-Za-z_][A-Za-z0-9_.-]*`; grammar keywords are reserved.

## Examples (from docs/grammar.md)

GrimMod:

```
curse spam-strikes: when message where count(message by same author flagged) >= 3 within 7 days -> mute author for 1 day; escalate to owner
```

Deadbeat:

```
curse late-payers: every 1 day where days_overdue >= 7 -> email polite-nudge to client
```

## Executor semantics that matter to an author

- `and`/`or` evaluate FLAT, left to right, no precedence: `a or b and c` means `(a or b) and c`. Keep chains short, or split into separate curses.
- A missing field makes the condition false (it is not an error).
- `contains` and `matches` are case-sensitive. `matches` is a JavaScript RegExp; invalid or ReDoS-prone patterns (e.g. `(a+)+`) evaluate to false.
- Ordering comparisons on non-numeric values are false.
- "flagged" means the event's `flagged` property is exactly `true`.
- A target is a field name: `mute author` reads the event field `author`; `email polite-nudge to client` reads `client`. A missing target field skips that action and the run is `partial`.
- `count(...)` includes the current event; with `by same <field>` it counts only events with the same value, and is 0 if the current event lacks the field.
- Actions only run through capabilities the host declared (chat, mail, notify). Do not try to name anything else.

## Install warnings

A curse can install successfully with warnings when its trigger can never fire in the host. Installs are never refused; the warning is the signal.

- GrimMod emits only `message` events: `every ...` and `on webhook ...` curses install but never run.
- Deadbeat emits only `tick` events, once per day: `when <event>` and `on webhook` curses never run, and an `every` interval other than 1 day (24 hours is equal) never runs.

So: moderation rules use `when message ...` for GrimMod; invoice rules use `every 1 day ...` for Deadbeat. If you get a warning back, rewrite the trigger for the right host rather than ignoring it.

## Checklist

1. Choose the host, then the trigger kind it can fire.
2. Write one line using only grammar productions.
3. Check durations are whole numbers, fields exist on the host's events, and string case matches.
4. Output the curse in a code block and mention any install warning it would produce.
