import type {
  Action, CompareCondition, CompareOp, Condition, Conditions, CountCondition, Curse,
  Duration, DurationUnit, Loc, TextCondition, Trigger, Value,
} from "./ast.js";
import { CurseSyntaxError } from "./errors.js";
import { tokenize, type Token } from "./tokenizer.js";

/** Words that structure the grammar; they cannot be used as names/fields/targets. */
const RESERVED = new Set([
  "curse", "when", "where", "every", "and", "or", "within", "for", "to", "by",
  "contains", "matches", "mute", "post", "email", "escalate",
]);

const UNITS: Record<string, DurationUnit> = {
  minute: "minute", minutes: "minute",
  hour: "hour", hours: "hour",
  day: "day", days: "day",
  week: "week", weeks: "week",
};

const COMPARE_OPS = new Set([">", ">=", "<", "<=", "="]);

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  // ---- cursor helpers ----
  private get cur(): Token { return this.tokens[this.pos]!; }
  private peek(n = 1): Token { return this.tokens[Math.min(this.pos + n, this.tokens.length - 1)]!; }
  private next(): Token { const t = this.cur; if (t.kind !== "eof") this.pos++; return t; }
  private atEof(): boolean { return this.tokens[this.pos]!.kind === "eof"; }
  private loc(t: Token = this.cur): Loc { return { line: t.line, column: t.column }; }

  private describe(t: Token): string {
    if (t.kind === "eof") return "end of input";
    if (t.kind === "string") return `string "${t.text}"`;
    if (t.kind === "number") return `number ${t.text}`;
    return `"${t.text}"`;
  }
  private fail(t: Token, message: string): never {
    throw new CurseSyntaxError(t.line, t.column, message);
  }
  private unexpected(expected: string): never {
    this.fail(this.cur, `expected ${expected} but found ${this.describe(this.cur)}`);
  }

  private isWord(text: string, t: Token = this.cur): boolean { return t.kind === "word" && t.text === text; }
  private isPunct(text: string, t: Token = this.cur): boolean { return t.kind === "punct" && t.text === text; }
  private expectWord(text: string, context?: string): Token {
    if (!this.isWord(text)) this.unexpected(`"${text}"${context ? ` ${context}` : ""}`);
    return this.next();
  }
  private expectPunct(text: string, context?: string): Token {
    if (!this.isPunct(text)) this.unexpected(`"${text}"${context ? ` ${context}` : ""}`);
    return this.next();
  }
  /** Identifier-like word: name, event, field, target, channel, template. */
  private expectIdent(what: string): Token {
    const t = this.cur;
    if (t.kind !== "word") this.unexpected(what);
    if (RESERVED.has(t.text)) this.fail(t, `expected ${what} but found keyword "${t.text}"`);
    return this.next();
  }
  private expectString(what: string): Token {
    if (this.cur.kind !== "string") this.unexpected(what);
    return this.next();
  }
  private expectNumber(what: string): Token {
    if (this.cur.kind !== "number") this.unexpected(what);
    return this.next();
  }

  // ---- grammar ----
  parseCurse(): Curse {
    if (this.atEof()) this.fail(this.cur, "empty source: expected a curse starting with \"curse\"");
    const start = this.expectWord("curse", "to start the rule");
    const name = this.expectIdent("a curse name");
    this.expectPunct(":", "after the curse name");
    const trigger = this.parseTrigger();
    this.expectPunct("->", "between the trigger and the first action");
    const actions: Action[] = [this.parseAction()];
    while (this.isPunct(";")) {
      this.next();
      actions.push(this.parseAction());
    }
    if (!this.atEof()) {
      this.unexpected('";" followed by another action, or the end of the curse');
    }
    return { kind: "curse", loc: this.loc(start), name: name.text, trigger, actions };
  }

  private parseTrigger(): Trigger {
    const t = this.cur;
    if (this.isWord("when")) {
      this.next();
      const event = this.expectIdent("an event name after \"when\"");
      const where = this.parseOptionalWhere();
      return { kind: "event", loc: this.loc(t), event: event.text, ...(where && { where }) };
    }
    if (this.isWord("every")) {
      this.next();
      const interval = this.parseDuration("an interval after \"every\" (e.g. 1 day)");
      // The Deadbeat example in DESIGN.md puts `where` after `every`; accepted deliberately.
      const where = this.parseOptionalWhere();
      return { kind: "timer", loc: this.loc(t), interval, ...(where && { where }) };
    }
    if (this.isWord("on")) {
      this.next();
      this.expectWord("webhook", 'after "on"');
      if (this.cur.kind !== "path") this.unexpected('a webhook path such as "/payments"');
      const path = this.next();
      return { kind: "webhook", loc: this.loc(t), path: path.text };
    }
    this.unexpected('a trigger ("when", "every" or "on webhook")');
  }

  private parseOptionalWhere(): Conditions | undefined {
    if (!this.isWord("where")) return undefined;
    this.next();
    const first = this.parseCondition();
    const rest: Conditions["rest"] = [];
    while (this.isWord("and") || this.isWord("or")) {
      const connector = this.next().text as "and" | "or";
      rest.push({ connector, condition: this.parseCondition() });
    }
    return { first, rest };
  }

  private parseCondition(): Condition {
    if (this.isWord("count") && this.isPunct("(", this.peek())) return this.parseCount();
    const fieldTok = this.expectIdent("a field name or count(...) condition");
    const loc = this.loc(fieldTok);
    const t = this.cur;
    if (t.kind === "punct" && COMPARE_OPS.has(t.text)) {
      this.next();
      const value = this.parseValue();
      const c: CompareCondition = { kind: "compare", loc, field: fieldTok.text, op: t.text as CompareOp, value };
      return c;
    }
    if (this.isWord("contains") || this.isWord("matches")) {
      const op = this.next().text as "contains" | "matches";
      const s = this.expectString(`a quoted string after "${op}"`);
      const c: TextCondition = { kind: "text", loc, field: fieldTok.text, op, pattern: s.text };
      return c;
    }
    this.unexpected('a comparison (> >= < <= =), "contains" or "matches"');
  }

  private parseCount(): CountCondition {
    const start = this.next(); // count
    this.expectPunct("(");
    const event = this.expectIdent("an event name inside count(...)").text;
    let bySameField: string | undefined;
    if (this.isWord("by")) {
      this.next();
      this.expectWord("same", 'after "by"');
      bySameField = this.expectIdent('a field after "by same"').text;
    }
    let flagged = false;
    if (this.isWord("flagged")) {
      this.next();
      flagged = true;
    }
    this.expectPunct(")", "to close count(");
    if (!this.isPunct(">=")) {
      this.unexpected('">=" (count conditions only support ">=")');
    }
    this.next();
    const n = this.expectNumber("a threshold number after \">=\"");
    const threshold = Number(n.text);
    if (!Number.isInteger(threshold) || threshold < 1) this.fail(n, "count threshold must be a whole number of at least 1");
    this.expectWord("within", "after the count threshold");
    const window = this.parseDuration('a window after "within" (e.g. 7 days)');
    return {
      kind: "count", loc: this.loc(start), event,
      ...(bySameField !== undefined && { bySameField }),
      flagged, op: ">=", threshold, window,
    };
  }

  private parseValue(): Value {
    const t = this.cur;
    if (t.kind === "number") { this.next(); return { type: "number", value: Number(t.text) }; }
    if (t.kind === "string") { this.next(); return { type: "string", value: t.text }; }
    if (t.kind === "word" && !RESERVED.has(t.text)) { this.next(); return { type: "word", value: t.text }; }
    this.unexpected("a value (number, string or word)");
  }

  private parseDuration(what: string): Duration {
    const n = this.expectNumber(what);
    const amount = Number(n.text);
    if (!(amount > 0)) this.fail(n, "a duration must be greater than zero");
    const u = this.cur;
    const unit = u.kind === "word" ? UNITS[u.text] : undefined;
    if (!unit) this.unexpected("a time unit (minutes, hours, days or weeks)");
    this.next();
    return { amount, unit };
  }

  private parseAction(): Action {
    const t = this.cur;
    if (this.isWord("mute")) {
      this.next();
      const target = this.expectIdent('a target after "mute" (e.g. author)');
      this.expectWord("for", "after the mute target");
      const duration = this.parseDuration('a duration after "for" (e.g. 1 day)');
      return { kind: "mute", loc: this.loc(t), target: target.text, duration };
    }
    if (this.isWord("post")) {
      this.next();
      const message = this.expectString('a quoted message after "post"');
      this.expectWord("to", "after the message");
      const channel = this.expectIdent('a channel after "to"');
      return { kind: "post", loc: this.loc(t), message: message.text, channel: channel.text };
    }
    if (this.isWord("email")) {
      this.next();
      const template = this.expectIdent('a template name after "email"');
      this.expectWord("to", "after the template name");
      const to = this.expectIdent('a field after "to"');
      return { kind: "email", loc: this.loc(t), template: template.text, to: to.text };
    }
    if (this.isWord("escalate")) {
      this.next();
      this.expectWord("to", 'after "escalate"');
      this.expectWord("owner", 'after "escalate to"');
      return { kind: "escalate", loc: this.loc(t), to: "owner" };
    }
    this.unexpected('an action ("mute", "post", "email" or "escalate")');
  }
}

/** Parse one curse. Throws CurseSyntaxError (with .line/.column) on tokenizer or grammar errors. */
export function parseCurse(source: string): Curse {
  return new Parser(tokenize(source)).parseCurse();
}

export type ParseResult =
  | { ok: true; curse: Curse }
  | { ok: false; error: { line: number; column: number; message: string } };

/** Non-throwing variant; the error shape matches the API's 422 {line, message}. */
export function tryParseCurse(source: string): ParseResult {
  try {
    return { ok: true, curse: parseCurse(source) };
  } catch (e) {
    if (e instanceof CurseSyntaxError) {
      return { ok: false, error: { line: e.line, column: e.column, message: e.detail } };
    }
    throw e;
  }
}
