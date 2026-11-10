import { describe, expect, it } from "vitest";
import { parseCurse, tryParseCurse } from "../src/index.js";

const GRIMMOD =
  "curse spam-strikes: when message where count(message by same author flagged) >= 3 within 7 days -> mute author for 1 day; escalate to owner";
const DEADBEAT = "curse late-payers: every 1 day where days_overdue >= 7 -> email polite-nudge to client";

describe("parser: DESIGN.md examples", () => {
  it("parses the GrimMod spam-strikes curse into a typed AST", () => {
    const c = parseCurse(GRIMMOD);
    expect(c.name).toBe("spam-strikes");
    expect(c.trigger).toMatchObject({
      kind: "event",
      event: "message",
      where: {
        first: {
          kind: "count", event: "message", bySameField: "author", flagged: true,
          op: ">=", threshold: 3, window: { amount: 7, unit: "day" },
        },
        rest: [],
      },
    });
    expect(c.actions).toMatchObject([
      { kind: "mute", target: "author", duration: { amount: 1, unit: "day" } },
      { kind: "escalate", to: "owner" },
    ]);
  });

  it("parses the Deadbeat late-payers curse", () => {
    const c = parseCurse(DEADBEAT);
    expect(c.name).toBe("late-payers");
    expect(c.trigger).toMatchObject({
      kind: "timer",
      interval: { amount: 1, unit: "day" },
      where: { first: { kind: "compare", field: "days_overdue", op: ">=", value: { type: "number", value: 7 } } },
    });
    expect(c.actions).toMatchObject([{ kind: "email", template: "polite-nudge", to: "client" }]);
  });

  it("parses the Deadbeat curse with the escalation tail", () => {
    const c = parseCurse(DEADBEAT + "; escalate to owner");
    expect(c.actions.map((a) => a.kind)).toEqual(["email", "escalate"]);
  });

  it("is deterministic and JSON-serialisable (AST round-trips)", () => {
    const c = parseCurse(GRIMMOD);
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
    expect(parseCurse(GRIMMOD)).toEqual(c);
  });

  it("records source locations", () => {
    const c = parseCurse("\n\ncurse x: when message -> escalate to owner");
    expect(c.loc).toEqual({ line: 3, column: 1 });
    expect(c.actions[0]!.loc.line).toBe(3);
  });
});

describe("parser: full grammar coverage", () => {
  it("webhook trigger and post action", () => {
    const c = parseCurse('curse hook: on webhook /payments/paid -> post "Thanks!" to general');
    expect(c.trigger).toMatchObject({ kind: "webhook", path: "/payments/paid" });
    expect(c.actions[0]).toMatchObject({ kind: "post", message: "Thanks!", channel: "general" });
  });

  it("all compare operators and value types", () => {
    for (const op of [">", ">=", "<", "<=", "="]) {
      const c = parseCurse(`curse t: when message where score ${op} 2.5 -> escalate to owner`);
      expect(c.trigger).toMatchObject({ where: { first: { kind: "compare", op } } });
    }
    const w = parseCurse('curse t: when message where status = overdue and name = "x" -> escalate to owner');
    expect(w.trigger).toMatchObject({
      where: { first: { value: { type: "word", value: "overdue" } }, rest: [{ connector: "and", condition: { value: { type: "string", value: "x" } } }] },
    });
  });

  it("text conditions and and/or chains keep source order", () => {
    const c = parseCurse(
      'curse t: when message where body contains "buy now" or body matches "^http" and score > 1 -> mute author for 2 hours',
    );
    const where = (c.trigger as { where: { first: unknown; rest: { connector: string }[] } }).where;
    expect(where.first).toMatchObject({ kind: "text", op: "contains", pattern: "buy now" });
    expect(where.rest.map((r) => r.connector)).toEqual(["or", "and"]);
  });

  it("count without 'by same' / 'flagged'; duration unit plurals", () => {
    const c = parseCurse("curse t: when message where count(message) >= 10 within 30 minutes -> mute author for 1 week");
    expect(c.trigger).toMatchObject({ where: { first: { kind: "count", flagged: false, window: { amount: 30, unit: "minute" } } } });
    expect(c.actions[0]).toMatchObject({ duration: { amount: 1, unit: "week" } });
  });

  it("allows a multi-line curse and reports the right line", () => {
    const src = "curse t:\n  when message\n  -> mute author for 1 day;\n  escalate to owner";
    expect(parseCurse(src).actions).toHaveLength(2);
  });
});

describe("parser: malformed curses give correct line errors", () => {
  const cases: { name: string; src: string; line: number; message: RegExp }[] = [
    { name: "missing arrow (line 2)", src: "curse a: when message\nmute author for 1 day", line: 2, message: /expected "->".*found "mute"/ },
    { name: "missing colon after name", src: "curse a when message -> escalate to owner", line: 1, message: /expected ":".*found "when"/ },
    { name: "unknown action on line 3", src: "curse a:\n  when message\n  -> ban author", line: 3, message: /expected an action.*"ban"/ },
    { name: "bad duration unit", src: "curse a: when message\n-> mute author for 1 fortnight", line: 2, message: /time unit.*"fortnight"/ },
    { name: "count with wrong operator", src: "curse a: when message where\n count(message) > 3 within 7 days -> escalate to owner", line: 2, message: /">=".*found ">"/ },
    { name: "unterminated string on line 2", src: 'curse a: when message -> \npost "hello to general', line: 2, message: /unterminated string/ },
    { name: "escalate to someone else", src: "curse a: when message -> escalate to everyone", line: 1, message: /"owner".*"everyone"/ },
    { name: "trailing junk after last action", src: "curse a: when message -> escalate to owner\nand more", line: 2, message: /end of the curse.*"and"/ },
    { name: "dangling semicolon at end of input", src: "curse a: when message -> escalate to owner;", line: 1, message: /an action.*end of input/ },
    { name: "keyword used as name", src: "curse where: when message -> escalate to owner", line: 1, message: /curse name.*keyword "where"/ },
    { name: "text condition without string", src: "curse a: when message where body contains spam -> escalate to owner", line: 1, message: /quoted string/ },
    { name: "missing trigger", src: "curse a: mute author for 1 day", line: 1, message: /trigger/ },
    { name: "zero duration", src: "curse a: when message -> mute author for 0 days", line: 1, message: /greater than zero/ },
    { name: "bad character on line 2", src: "curse a: when message\n-> mute author for 1 day; @", line: 2, message: /unexpected character "@"/ },
    { name: "empty source", src: "  \n ", line: 1, message: /empty source/ },
    { name: "must start with curse", src: "when message -> escalate to owner", line: 1, message: /"curse"/ },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const r = tryParseCurse(c.src);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.line).toBe(c.line);
        expect(r.error.message).toMatch(c.message);
      }
      expect(() => parseCurse(c.src)).toThrow(new RegExp(`^line ${c.line}: `));
    });
  }
});
