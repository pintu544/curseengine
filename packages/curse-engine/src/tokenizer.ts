import { CurseSyntaxError } from "./errors.js";

export type TokenKind = "word" | "number" | "string" | "path" | "punct" | "eof";

export interface Token {
  kind: TokenKind;
  /** word/punct text, string contents (unescaped), path text, or number literal text */
  text: string;
  line: number;
  column: number;
}

const isAlpha = (c: string | undefined) => c !== undefined && /[A-Za-z_]/.test(c);
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
const isWordCont = (c: string | undefined) => isAlpha(c) || isDigit(c);
const isPathChar = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_\-./]/.test(c);

/** Hand-written scanner. Newlines are whitespace; every token carries its 1-based line/column. */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const advance = () => {
    if (source[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    i++;
  };
  const push = (kind: TokenKind, text: string, l: number, c: number) =>
    tokens.push({ kind, text, line: l, column: c });

  while (i < source.length) {
    const ch = source[i]!;
    const l = line;
    const c = col;

    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      advance();
      continue;
    }

    if (isAlpha(ch)) {
      let text = "";
      while (i < source.length) {
        const cur = source[i];
        const next = source[i + 1];
        if (isWordCont(cur)) {
          text += cur;
          advance();
        } else if ((cur === "-" || cur === ".") && isWordCont(next)) {
          text += cur; // hyphen/dot only inside a word: spam-strikes, author.id
          advance();
        } else break;
      }
      push("word", text, l, c);
      continue;
    }

    if (isDigit(ch) || (ch === "-" && isDigit(source[i + 1]))) {
      let text = "";
      if (ch === "-") {
        text += ch;
        advance();
      }
      while (isDigit(source[i])) {
        text += source[i];
        advance();
      }
      if (source[i] === "." && isDigit(source[i + 1])) {
        text += ".";
        advance();
        while (isDigit(source[i])) {
          text += source[i];
          advance();
        }
      }
      push("number", text, l, c);
      continue;
    }

    if (ch === '"') {
      advance();
      let text = "";
      let closed = false;
      while (i < source.length) {
        const cur = source[i]!;
        if (cur === "\n") break;
        if (cur === '"') {
          advance();
          closed = true;
          break;
        }
        if (cur === "\\") {
          const esc = source[i + 1];
          if (esc === '"' || esc === "\\") text += esc;
          else if (esc === "n") text += "\n";
          else throw new CurseSyntaxError(line, col, `unknown escape sequence "\\${esc ?? ""}" in string`);
          advance();
          advance();
          continue;
        }
        text += cur;
        advance();
      }
      if (!closed) throw new CurseSyntaxError(l, c, "unterminated string (missing closing quote)");
      push("string", text, l, c);
      continue;
    }

    if (ch === "/") {
      let text = "";
      while (isPathChar(source[i])) {
        text += source[i];
        advance();
      }
      if (text.length < 2) throw new CurseSyntaxError(l, c, 'a webhook path must look like "/name"');
      push("path", text, l, c);
      continue;
    }

    if (ch === "-" && source[i + 1] === ">") {
      advance();
      advance();
      push("punct", "->", l, c);
      continue;
    }
    if ((ch === ">" || ch === "<") && source[i + 1] === "=") {
      advance();
      advance();
      push("punct", ch + "=", l, c);
      continue;
    }
    if (":;()<>=".includes(ch)) {
      advance();
      push("punct", ch, l, c);
      continue;
    }

    throw new CurseSyntaxError(l, c, `unexpected character "${ch}"`);
  }

  // EOF sits at the end of the last real token's line so "unexpected end" points at real text.
  const last = tokens[tokens.length - 1];
  tokens.push({
    kind: "eof",
    text: "",
    line: last ? last.line : 1,
    column: last ? last.column + Math.max(last.text.length, 1) : 1,
  });
  return tokens;
}
