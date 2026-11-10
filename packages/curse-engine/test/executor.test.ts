import { describe, expect, it } from "vitest";
import { createExecutor, parseCurse, UndeclaredCapabilityError, type Capabilities, type EngineEvent } from "../src/index.js";

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
