import { describe, expect, it } from "vitest";
import { createExecutor, parseCurse, simulate, summaryLine, type Capabilities, type EngineEvent } from "../src/index.js";

const SPAM = "curse spam-strikes: when message where count(message by same author flagged) >= 3 within 7 days -> mute author for 1 day; escalate to owner";
const DAY = 86_400_000;
const msg = (id: string, at: number, author: string, flagged = true): EngineEvent => ({ id, type: "message", at, fields: { author }, flagged });

describe("simulate()", () => {
  it("records intended actions with a stub and reports a summary", async () => {
    const events = [msg("a1", 1, "bob"), msg("a2", 2, "bob"), msg("a3", 3, "bob"), msg("c1", 4, "cy"), msg("c2", 5, "cy")];
    const report = await simulate({ curses: [parseCurse(SPAM)], events, quotaPerHour: 100 });
    expect(report.intended.map((a) => [a.kind, a.target, a.eventId])).toEqual([["mute", "bob", "a3"], ["escalate", "owner", "a3"]]);
    expect(report.summary.mutedTargets).toEqual(["bob"]);
    expect(report.summary.byKind.mute).toEqual({ taken: 1, skipped: 0, failed: 0 });
    expect(report.summary.perTarget).toEqual([{ kind: "mute", target: "bob", count: 1 }, { kind: "escalate", target: "owner", count: 1 }]);
    expect(report.decisions).toHaveLength(5);
    expect(summaryLine(report, ["bob"])).toBe("1 muted, 0 false positives");
    expect(summaryLine(report, ["cy"])).toBe("1 muted, 1 false positive");
    expect(summaryLine(report)).toBe("1 muted, 1 escalated, 0 posted, 0 emailed");
  });

  it("uses the same Executor class as live runs", async () => {
    const live = createExecutor({ curses: [], capabilities: {}, quotaPerHour: 1 });
    // simulate() builds its executors with createExecutor; its decisions match a live executor's shape exactly.
    const caps: Capabilities = { mute() {}, post() {}, email() {}, escalate() {} };
    const liveEx = createExecutor({ curses: [parseCurse(SPAM)], capabilities: caps, quotaPerHour: 5 });
    const events = [msg("a1", 1, "bob"), msg("a2", 2, "bob"), msg("a3", 3, "bob")];
    const liveRecords = [];
    for (const e of events) liveRecords.push(...(await liveEx.handle(e)));
    const report = await simulate({ curses: [parseCurse(SPAM)], events, quotaPerHour: 5 });
    expect(report.decisions).toEqual(liveRecords);
    expect(live.constructor).toBe(liveEx.constructor);
  });

  it("suppresses events from a simulated-muted author and fabricates no decision for them", async () => {
    const events = [msg("a1", 1, "bob"), msg("a2", 2, "bob"), msg("a3", 3, "bob"), msg("a4", 4, "bob"), msg("a5", 3 + DAY + 1, "bob")];
    const report = await simulate({ curses: [parseCurse(SPAM)], events, quotaPerHour: 100 });
    expect(report.suppressed).toEqual([{ eventId: "a4", author: "bob", at: 4, mutedBy: "spam-strikes" }]);
    expect(report.decisions.map((d) => d.eventId)).toEqual(["a1", "a2", "a3", "a5"]);
    expect(report.summary.suppressed).toBe(1);
  });

  it("applies the monotonic host clock to backdated events", async () => {
    const report = await simulate({ curses: [parseCurse(SPAM)], events: [msg("a1", 100, "bob"), msg("a0", 5, "bob")], quotaPerHour: 100 });
    expect(report.decisions.map((d) => d.at)).toEqual([100, 100]);
  });

  it("honours the declared capability set (undeclared email is refused, others unaffected)", async () => {
    const mail = parseCurse("curse mailer: when message -> email nudge to author");
    const report = await simulate({ curses: [mail, parseCurse(SPAM)], events: [msg("a1", 1, "bob")], quotaPerHour: 9, declared: ["mute", "post", "escalate"] });
    expect(report.decisions.find((d) => d.curse === "mailer")?.outcome).toBe("failed");
    expect(report.intended).toEqual([]);
  });

  it("records a skipped action with no target and counts it as skipped", async () => {
    const c = parseCurse('curse m: when message -> mute reporter for 1 hour');
    const report = await simulate({ curses: [c], events: [msg("a1", 1, "bob")], quotaPerHour: 9 });
    expect(report.decisions[0]!.outcome).toBe("partial");
    expect(report.summary.byKind.mute.skipped).toBe(1);
    expect(report.summary.mutedTargets).toEqual([]);
  });

  it("regression (shrunk from the parity property): overlapping mutes keep the longest coverage", async () => {
    // Two curses mute the same author on one event, a day and then 30 minutes. A last-write-wins model would
    // let the later, shorter mute shorten the day-long one; the host keeps every mute and uses the longest.
    const curses = [parseCurse("curse long: when message -> mute author for 1 day"), parseCurse("curse short: when message -> mute author for 30 minutes")];
    const T = 1_700_000_000_000;
    const events: EngineEvent[] = [
      { id: "e0", type: "message", at: T, fields: { author: "dee" } },
      { id: "e1", type: "message", at: T + 1_800_000, fields: {} },
      { id: "e2", type: "message", at: T, fields: { author: "dee" } }, // backdated to T+30min
    ];
    const report = await simulate({ curses, events, quotaPerHour: 9 });
    expect(report.suppressed.map((s) => s.eventId)).toEqual(["e2"]);
  });

  it("W2: duplicate curse names resolve last-wins, matching GrimModHost.install", async () => {
    const v1 = parseCurse('curse dup: when message -> post "v1" to general');
    const v2 = parseCurse('curse dup: when message -> post "v2" to general');
    const report = await simulate({ curses: [v1, v2], events: [msg("a1", 1, "bob", false)], quotaPerHour: 9 });
    expect(report.decisions).toHaveLength(1);
    expect(report.intended.map((a) => a.message)).toEqual(["v2"]);
  });

  it("W3: an undeclared-capability curse is refused identically per event and consumes no quota", async () => {
    const mail = parseCurse("curse mailer: when message -> email nudge to author");
    const events = [msg("a1", 1, "bob", false), msg("a2", 2, "bob", false), msg("a3", 3, "bob", false)];
    const report = await simulate({ curses: [mail], events, quotaPerHour: 1, declared: ["mute", "post", "escalate"] });
    expect(report.decisions).toHaveLength(3);
    expect(report.decisions.map((d) => d.outcome)).toEqual(["failed", "failed", "failed"]);
    expect(report.decisions.some((d) => d.outcome === "skipped-quota")).toBe(false);
    const shape = (d: (typeof report.decisions)[number]) => ({ ...d, eventId: "", at: 0 });
    expect(shape(report.decisions[1]!)).toEqual(shape(report.decisions[0]!));
    expect(shape(report.decisions[2]!)).toEqual(shape(report.decisions[0]!));
    expect(report.intended).toEqual([]);
  });
});
