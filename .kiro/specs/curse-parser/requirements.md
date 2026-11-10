# Requirements — Tokenizer + parser (T1.3, FR1)

1. WHEN a source string containing one curse in the frozen grammar is given THEN `parseCurse` SHALL return a typed, JSON-serialisable AST with source locations.
2. WHEN the source is syntactically invalid THEN the parser SHALL throw `CurseSyntaxError` carrying the 1-based `line` and `column` of the offending token and a human-readable message; `tryParseCurse` SHALL return the same as `{ok:false, error:{line, column, message}}` (maps to API 422 `{line, message}`).
3. The parser SHALL parse both DESIGN.md example curses (GrimMod `spam-strikes`, Deadbeat `late-payers`).
4. The parser SHALL accept nothing outside the frozen grammar (see interpretations in `../curse-engine/design.md`) and SHALL NOT use `eval`, `Function`, regex-based whole-input parsing, or any LLM.
5. Newlines are whitespace; errors point at the line where the offending token sits (EOF errors point at the end of the last token).
6. Compilation SHALL be well under 200 ms (NFR2).
