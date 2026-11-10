import { describe, expect, it } from "vitest";
import { CurseSyntaxError, tokenize } from "../src/index.js";

describe("tokenizer", () => {
  it("scans words (hyphenated), numbers, strings, punctuation and paths with positions", () => {
    const t = tokenize('curse a-b: >= <= -> "hi \\"x\\"" 3.5 -2 /hook');
    expect(t.map((x) => [x.kind, x.text])).toEqual([
      ["word", "curse"], ["word", "a-b"], ["punct", ":"], ["punct", ">="], ["punct", "<="],
      ["punct", "->"], ["string", 'hi "x"'], ["number", "3.5"], ["number", "-2"], ["path", "/hook"],
      ["eof", ""],
    ]);
    expect(t[0]).toMatchObject({ line: 1, column: 1 });
    expect(t[1]).toMatchObject({ line: 1, column: 7 });
  });

  it("does not swallow '->' into a preceding word", () => {
    expect(tokenize("owner->x").map((x) => x.text)).toEqual(["owner", "->", "x", ""]);
  });

  it("tracks lines across newlines", () => {
    const t = tokenize("curse\n\n  x");
    expect(t[1]).toMatchObject({ text: "x", line: 3, column: 3 });
  });

  it("rejects unexpected characters, unterminated strings, bare slashes", () => {
    expect(() => tokenize("curse $")).toThrow(CurseSyntaxError);
    expect(() => tokenize('a\n"oops')).toThrow(/line 2: unterminated string/);
    expect(() => tokenize("a / b")).toThrow(/webhook path/);
  });
});
