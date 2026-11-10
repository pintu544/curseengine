# Design — Tokenizer + parser

- `src/tokenizer.ts` — hand-written scanner → `Token{kind: word|number|string|path|punct|eof, text, line, column}`. Hyphen/dot allowed inside words only when followed by a word char (so `owner->` still lexes). Negative number literals; `"..."` strings with `\"`, `\\`, `\n` escapes, single-line; `/path` tokens for webhooks.
- `src/ast.ts` — discriminated unions: `Curse`, `Trigger` (event|timer|webhook), `Conditions` (flat chain), `Condition` (count|compare|text), `Action` (mute|post|email|escalate). Every node has `loc`.
- `src/parser.ts` — recursive descent, one method per grammar rule, fail-fast with `expected X but found Y`. Reserved keywords cannot be identifiers.
- `src/errors.ts` — `CurseSyntaxError{line, column, detail}`.
- Public API from `src/index.ts`: `parseCurse`, `tryParseCurse`, `tokenize`, AST types.
