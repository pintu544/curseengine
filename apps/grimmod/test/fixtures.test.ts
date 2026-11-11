import { describe, expect, it } from "vitest";
import { POST as refresh } from "../app/api/fixtures/route";
import { POST as simulate } from "../app/api/curses/[id]/simulate/route";
import { REFERENCE_NOW, simulationHistory } from "@/lib/fixtures";
import { POST as postEvent } from "../app/api/events/route";
import { GET as getGrimoire } from "../app/api/grimoire/route";
import { getHost, refreshFixtures } from "@/lib/host";

const sim = () =>
  simulate(new Request("http://test/x", { method: "POST", body: "{}" }), { params: Promise.resolve({ id: "spam-strikes" }) }).then((r) => r.json());

describe("fixture contract", () => {
  it("simulation history has stable unique ids and sits at or before the reference clock", () => {
    const a = simulationHistory();
    expect(a.map((m) => m.id)).toEqual(simulationHistory().map((m) => m.id));
    expect(new Set(a.map((m) => m.id)).size).toBe(a.length);
    expect(a.every((m) => m.at <= REFERENCE_NOW)).toBe(true);
    expect(JSON.stringify(simulationHistory())).toBe(JSON.stringify(a));
  });

  it("refreshing twice gives identical message/curse counts and identical simulation results", async () => {
    const r1 = await (await refresh()).json();
    const s1 = await sim();
    const snap1 = JSON.stringify(getHost().chat.snapshot());
    const r2 = await (await refresh()).json();
    const s2 = await sim();
    expect(r2.messages).toBe(r1.messages);
    expect(r2.curses).toEqual(r1.curses);
    expect(r1.curses).toEqual(["spam-strikes"]);
    expect(JSON.stringify(s2)).toBe(JSON.stringify(s1));
    expect(JSON.stringify(getHost().chat.snapshot())).toBe(snap1);
    expect(s1.summaryLine).toBe("3 muted, 0 false positives");
  });

  it("refresh discards live activity", async () => {
    refreshFixtures();
    await getHost().receive({ id: "l1", author: "x", channel: "general", text: "hi", at: REFERENCE_NOW + 1, flagged: false });
    const before = getHost().chat.messages.length;
    const r = await (await refresh()).json();
    expect(r.messages).toBe(before - 1);
  });

  it("is a full demo reset: marks reset:true and discards grimoire, mutes, suppressed list and decisions", async () => {
    await refresh();
    const ev = (text: string) => postEvent(new Request("http://test/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ author: "raid-bot", text, flagged: true }) }));
    for (let i = 0; i < 3; i++) await ev(`RAID ${i}`);
    await ev("while muted");
    const before = await (await getGrimoire()).json();
    expect(before.entries.length).toBeGreaterThan(0);
    expect(before.suppressedTotal).toBe(1);
    expect(getHost().chat.mutes).toHaveLength(1);
    expect(getHost().decisions.length).toBeGreaterThan(0);

    const r = await (await refresh()).json();
    expect(r.reset).toBe(true);
    const after = await (await getGrimoire()).json();
    expect(after.entries).toEqual([]);
    expect(after.suppressedTotal).toBe(0);
    expect(after.suppressed).toEqual([]);
    expect(getHost().decisions).toEqual([]);
    expect(getHost().chat.mutes).toEqual([]);
    expect(getHost().chat.snapshot().mutes).toEqual([]);
    expect(r.curses).toEqual(["spam-strikes"]);
  });
});
