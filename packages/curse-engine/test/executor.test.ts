import { describe, expect, it } from "vitest";
import { catastrophicShape, createExecutor, MATCH_SUBJECT_CAP, parseCurse, UndeclaredCapabilityError, type Capabilities, type EngineEvent } from "../src/index.js";

const GRIMMOD =
  "curse spam-strikes: when message where count(message by same author flagged) >= 3 within 7 days -> mute author for 1 day; escalate to owner";
const DEADBEAT = "curse late-payers: every 1 day where days_overdue >= 7 -> email polite-nudge to client";
const DAY = 86_400_000;

function stub() {
  const calls: { cap: string; req: any }[] = [];
  const caps: Capabilities = {
    mute: (r) => void calls.push({ cap: "mute", req: r }),
    post: (r) => void calls.push({ cap: "post", req: r }),
    email: (r) => void calls.push({ cap: "email", req: r }),
    escalate: (r) => void calls.push({ cap: "escalate", req: r }),
  };
  return { calls, caps };
}
const msg = (id: string, at: number, author: string, flagged = true): EngineEvent => ({ id, type: "message", at, fields: { author }, flagged });

describe("executor end-to-end", () => {
  it("GrimMod spam-strikes mutes and escalates on the 3rd flagged message in 7 days", async () => {
    const { calls, caps } = stub();
    const ex = createExecutor({ curses: [parseCurse(GRIMMOD)], capabilities: caps, quotaPerHour: 10 });
    await ex.handle(msg("m1", 0, "bob"));
    await ex.handle(msg("x1", 1, "amy"));
    await ex.handle(msg("m2", DAY, "bob"));
    await ex.handle(msg("u1", DAY, "bob", false)); // unflagged: not counted
    expect(calls).toEqual([]);
    const [rec] = await ex.handle(msg("m3", 2 * DAY, "bob"));
    expect(calls.map((c) => [c.cap, c.req.target ?? c.req.to])).toEqual([["mute", "bob"], ["escalate", "owner"]]);
    expect(calls[0]!.req.durationMs).toBe(DAY);
    expect(rec).toMatchObject({
      curse: "spam-strikes", eventId: "m3", matched: true, outcome: "executed",
      conditions: [{ kind: "count", observed: 3, expected: 3, result: true }],
      actions: [{ kind: "mute", target: "bob", status: "taken" }, { kind: "escalate", status: "taken" }],
    });
  });

  it("count window excludes old events", async () => {
    const { calls, caps } = stub();
    const ex = createExecutor({ curses: [parseCurse(GRIMMOD)], capabilities: caps, quotaPerHour: 10 });
    await ex.handle(msg("a", 0, "bob"));
    await ex.handle(msg("b", DAY, "bob"));
    const [rec] = await ex.handle(msg("c", 8 * DAY, "bob"));
    expect(rec!.matched).toBe(false);
    expect(rec!.conditions[0]!.observed).toBe(1);
    expect(calls).toEqual([]);
  });

  it("Deadbeat late-payers emails when days_overdue >= 7 on a daily tick", async () => {
    const { calls, caps } = stub();
    const ex = createExecutor({ curses: [parseCurse(DEADBEAT)], capabilities: caps, quotaPerHour: 10 });
    const tick = (id: string, d: number): EngineEvent => ({ id, type: "tick", at: 0, interval: { amount: 1, unit: "day" }, fields: { days_overdue: d, client: "acme@example.com" } });
    const [no] = await ex.handle(tick("t1", 6));
    expect(no).toMatchObject({ matched: false, outcome: "no-match" });
    const [yes] = await ex.handle(tick("t2", 7));
    expect(calls).toEqual([{ cap: "email", req: expect.objectContaining({ template: "polite-nudge", to: "acme@example.com" }) }]);
    expect(yes!.conditions[0]).toMatchObject({ observed: 7, expected: 7, result: true });
  });

  it("matches webhook triggers by path and supports contains/matches", async () => {
    const { calls, caps } = stub();
    const ex = createExecutor({
      curses: [
        parseCurse('curse hook: on webhook /pay -> post "paid" to ops'),
        parseCurse('curse t: when message where text contains "buy" and text matches "^b.y" -> post "hit" to mods'),
      ],
      capabilities: caps, quotaPerHour: 10,
    });
    await ex.handle({ id: "w", type: "webhook", at: 0, fields: { path: "/pay" } });
    await ex.handle({ id: "w2", type: "webhook", at: 0, fields: { path: "/other" } });
    await ex.handle({ id: "m", type: "message", at: 0, fields: { text: "buy now" } });
    expect(calls.map((c) => c.req.message)).toEqual(["paid", "hit"]);
  });

  it("evaluates and/or flat in source order (no precedence)", async () => {
    const { calls, caps } = stub();
    // flat: ((a=1 or b=1) and c=1). With precedence it would be a=1 or (b=1 and c=1) => true for a=1,c=0.
    const ex = createExecutor({
      curses: [parseCurse('curse f: when message where a = 1 or b = 1 and c = 1 -> post "x" to ops')],
      capabilities: caps, quotaPerHour: 10,
    });
    const [rec] = await ex.handle({ id: "e", type: "message", at: 0, fields: { a: 1, b: 0, c: 0 } });
    expect(rec!.matched).toBe(false);
    expect(calls).toEqual([]);
  });

  it("supports all five compare operators", async () => {
    const { caps } = stub();
    for (const [op, v, want] of [[">", 6, true], [">", 5, false], [">=", 5, true], ["<", 4, true], ["<=", 5, true], ["=", 5, true], ["=", 4, false]] as const) {
      const ex = createExecutor({ curses: [parseCurse(`curse c: when message where n ${op} 5 -> post "x" to ops`)], capabilities: caps, quotaPerHour: 10 });
      const [rec] = await ex.handle({ id: "e", type: "message", at: 0, fields: { n: v } });
      expect(rec!.matched, `${v} ${op} 5`).toBe(want);
    }
  });
});

describe("sandbox", () => {
  it("fails with a clear error when a curse invokes an undeclared capability, executing nothing", async () => {
    const { calls, caps } = stub();
    const { escalate: _omit, ...declared } = caps; // host never declares escalate
    const ex = createExecutor({ curses: [parseCurse(GRIMMOD)], capabilities: declared, quotaPerHour: 10 });
    await ex.handle(msg("m1", 0, "bob"));
    await ex.handle(msg("m2", 1, "bob"));
    const err = await ex.handle(msg("m3", 2, "bob")).catch((e) => e);
    expect(err).toBeInstanceOf(UndeclaredCapabilityError);
    expect(err.message).toMatch(/capability "escalate" which the host did not declare/);
    expect(calls).toEqual([]); // mute (declared) must not have run: whole run refused
    expect(ex.records.at(-1)).toMatchObject({ outcome: "failed", actions: [{ kind: "mute", status: "skipped" }, { kind: "escalate", status: "failed", reason: expect.stringContaining("undeclared") }] });
  });
});

describe("hourly quota", () => {
  it("skips executions beyond the quota and records the skip", async () => {
    const { calls, caps } = stub();
    const ex = createExecutor({ curses: [parseCurse('curse q: when message -> post "hi" to ops')], capabilities: caps, quotaPerHour: 2 });
    const recs = [];
    for (let i = 0; i < 4; i++) recs.push((await ex.handle({ id: `e${i}`, type: "message", at: i * 1000, fields: {} }))[0]!);
    expect(recs.map((r) => r.outcome)).toEqual(["executed", "executed", "skipped-quota", "skipped-quota"]);
    expect(calls).toHaveLength(2);
    expect(recs[2]).toMatchObject({ matched: true, quota: { used: 2, limit: 2 }, actions: [{ status: "skipped", reason: expect.stringContaining("quota") }] });
    const later = (await ex.handle({ id: "late", type: "message", at: 3_700_000, fields: {} }))[0]!;
    expect(later.outcome).toBe("executed");
  });
});

describe("matches: ReDoS guard", () => {
  const run = async (pattern: string, text: string) => {
    const { caps } = stub();
    const ex = createExecutor({ curses: [parseCurse(`curse r: when message where text matches "${pattern}" -> post "x" to ops`)], capabilities: caps, quotaPerHour: 10 });
    const t0 = performance.now();
    const [rec] = await ex.handle({ id: "e", type: "message", at: 0, fields: { text } });
    return { rec: rec!, ms: performance.now() - t0 };
  };

  it("rejects ^(a+)+$ against a hostile subject in well under a second, noting the reason", async () => {
    const { rec, ms } = await run("^(a+)+$", "a".repeat(40) + "!");
    expect(ms).toBeLessThan(500);
    expect(rec.matched).toBe(false);
    expect(rec.conditions[0]).toMatchObject({ kind: "text", result: false, note: expect.stringContaining("pattern rejected") });
  });

  it("rejects the other nested-repetition shapes", () => {
    for (const p of ["(a*)*", "(a+)+", "(a|a)+", "(a|aa)*", "((a+)?)+", "(\\w+\\s?)*$", "(a+){2,}", "(x+x+)+y"]) {
      expect(catastrophicShape(p), p).toBeDefined();
    }
  });

  it("allows ordinary patterns", () => {
    for (const p of ["buy .* now", "^https?://", "^b.y", "(foo|bar)+", "(ab)+", "(a+)?", "(?:https?|ftp)://", "[a-z]+@[a-z]+\\.com", "a{2,3}b+", "(\\d{3})-(\\d{4})"]) {
      expect(catastrophicShape(p), p).toBeUndefined();
    }
  });

  it("still matches legitimate patterns correctly", async () => {
    expect((await run("buy .* now", "please buy this now")).rec.matched).toBe(true);
    expect((await run("buy .* now", "please sell this now")).rec.matched).toBe(false);
    expect((await run("^https?://", "https://example.com")).rec.matched).toBe(true);
    expect((await run("^https?://", "ftp://example.com")).rec.matched).toBe(false);
  });

  it("only considers the first 10,000 characters of the subject", async () => {
    const text = "a".repeat(MATCH_SUBJECT_CAP) + "needle";
    const r = await run("needle", text);
    expect(r.rec.matched).toBe(false);
    expect(r.rec.conditions[0]!.note).toMatch(/first 10000/);
    expect((await run("^a+$", "a".repeat(MATCH_SUBJECT_CAP + 5))).rec.matched).toBe(true);
  });

  it("invalid regex still evaluates to false with a note", async () => {
    const r = await run("(", "x");
    expect(r.rec.conditions[0]).toMatchObject({ result: false, note: "invalid regular expression" });
  });
});

describe("decision record fidelity for skipped actions", () => {
  it("records a null target plus the unresolved field name, and the outcome is partial", async () => {
    const { calls, caps } = stub();
    const ex = createExecutor({ curses: [parseCurse("curse p: when message -> mute reporter for 1 day; escalate to owner")], capabilities: caps, quotaPerHour: 10 });
    const [rec] = await ex.handle({ id: "e", type: "message", at: 0, fields: { author: "bob" } });
    expect(calls.map((c) => c.cap)).toEqual(["escalate"]);
    expect(rec!.outcome).toBe("partial");
    expect(rec!.actions[0]).toEqual({ kind: "mute", target: null, targetField: "reporter", status: "skipped", reason: 'event has no field "reporter"' });
    expect(rec!.actions[1]).toMatchObject({ kind: "escalate", target: "owner", status: "taken" });
    expect(rec!.quota.used).toBe(1); // a partial run is still a run
  });

  it("a fully executed run stays 'executed' and resolves real targets", async () => {
    const { caps } = stub();
    const ex = createExecutor({ curses: [parseCurse("curse p: when message -> mute author for 1 day")], capabilities: caps, quotaPerHour: 10 });
    const [rec] = await ex.handle({ id: "e", type: "message", at: 0, fields: { author: "bob" } });
    expect(rec!.outcome).toBe("executed");
    expect(rec!.actions[0]).toMatchObject({ target: "bob", status: "taken" });
    expect(rec!.actions[0]).not.toHaveProperty("targetField");
  });

  it("never puts a field name in target for unmatched or quota-skipped runs", async () => {
    const { caps } = stub();
    const ex = createExecutor({ curses: [parseCurse("curse p: when message where n > 1 -> mute author for 1 day")], capabilities: caps, quotaPerHour: 10 });
    const [rec] = await ex.handle({ id: "e", type: "message", at: 0, fields: { author: "bob", n: 0 } });
    expect(rec!.outcome).toBe("no-match");
    expect(rec!.actions[0]).toMatchObject({ target: null, targetField: "author", status: "skipped" });
  });

  it("failed beats partial when a capability throws", async () => {
    const caps: Capabilities = { mute() {}, escalate() { throw new Error("boom"); } };
    const ex = createExecutor({ curses: [parseCurse("curse p: when message -> mute reporter for 1 day; escalate to owner")], capabilities: caps, quotaPerHour: 10 });
    const [rec] = await ex.handle({ id: "e", type: "message", at: 0, fields: {} });
    expect(rec!.outcome).toBe("failed");
  });
});

describe("capabilities are own-properties only", () => {
  it("an inherited capability is undeclared: preflight fails and nothing executes", async () => {
    const fired: string[] = [];
    const caps = Object.create({ mute: () => void fired.push("mute") }) as Capabilities;
    caps.escalate = () => void fired.push("escalate");
    const ex = createExecutor({ curses: [parseCurse("curse p: when message -> escalate to owner; mute author for 1 day")], capabilities: caps, quotaPerHour: 10 });
    await expect(ex.handle({ id: "e", type: "message", at: 0, fields: { author: "bob" } })).rejects.toBeInstanceOf(UndeclaredCapabilityError);
    expect(fired).toEqual([]);
    expect(ex.records.at(-1)).toMatchObject({ outcome: "failed", actions: [{ status: "skipped" }, { kind: "mute", status: "failed", reason: expect.stringContaining("undeclared") }] });
  });

  it("an inherited capability is undeclared even when it is the only action", async () => {
    const fired: string[] = [];
    const caps = Object.create({ mute: () => void fired.push("mute") }) as Capabilities;
    const ex = createExecutor({ curses: [parseCurse("curse p: when message -> mute author for 1 day")], capabilities: caps, quotaPerHour: 10 });
    await expect(ex.handle({ id: "e", type: "message", at: 0, fields: { author: "bob" } })).rejects.toThrow(/did not declare/);
    expect(fired).toEqual([]);
  });
});

describe("count history is bounded", () => {
  const counter = (n: number, window: string) =>
    parseCurse(`curse c: when message where count(message by same author flagged) >= ${n} within ${window} -> post "hit" to ops`);

  it("keeps exact (at - window, at] semantics while pruning older events", async () => {
    const { calls, caps } = stub();
    const ex = createExecutor({ curses: [counter(3, "1 hour")], capabilities: caps, quotaPerHour: 1000 });
    const H = 3_600_000;
    // Filler far in the past forces pruning; the boundary event at exactly (at - window) must NOT count.
    for (let i = 0; i < 3000; i++) await ex.handle(msg(`old${i}`, i, "zed"));
    const base = 10 * H;
    await ex.handle(msg("b0", base, "amy"));
    await ex.handle(msg("b1", base + 1000, "amy"));
    const [r] = await ex.handle(msg("b2", base + H, "amy")); // b0 is exactly at (at - window): excluded
    expect(r!.conditions[0]!.observed).toBe(2);
    expect(calls.filter((c) => String(c.req.eventId).startsWith("b"))).toEqual([]);
    const [r2] = await ex.handle(msg("b3", base + H + 1, "amy")); // b1, b2, b3 in window
    expect(r2!.conditions[0]!.observed).toBe(3);
    expect(calls.filter((c) => String(c.req.eventId).startsWith("b"))).toHaveLength(1);
  });

  it("retains nothing when no installed curse has a count condition", async () => {
    const { caps } = stub();
    const ex = createExecutor({ curses: [parseCurse('curse p: when message -> post "x" to ops')], capabilities: caps, quotaPerHour: 1_000_000 });
    for (let i = 0; i < 500; i++) await ex.handle(msg(`m${i}`, i, "a"));
    expect((ex as unknown as { retained: number }).retained).toBe(0);
  });

  it("drops events older than the largest window", async () => {
    const { caps } = stub();
    const ex = createExecutor({ curses: [counter(2, "1 hour")], capabilities: caps, quotaPerHour: 1_000_000 });
    for (let i = 0; i < 5000; i++) await ex.handle(msg(`m${i}`, i * 60_000, "a")); // one per minute
    expect((ex as unknown as { retained: number }).retained).toBeLessThan(1500);
  });

  it("ingests 40,000 events quickly", async () => {
    const { caps } = stub();
    const ex = createExecutor({ curses: [counter(3, "7 days")], capabilities: caps, quotaPerHour: 1_000_000 });
    const t0 = performance.now();
    for (let i = 0; i < 40_000; i++) await ex.handle(msg(`m${i}`, i * 1000, `u${i % 50}`, i % 3 === 0));
    expect(ex.records.length).toBe(40_000);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});
