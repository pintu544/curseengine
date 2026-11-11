import { beforeEach, describe, expect, it } from "vitest";
import { POST as postCurse } from "../app/api/curses/route";
import { POST as simulate } from "../app/api/curses/[id]/simulate/route";
import { POST as reset } from "../app/api/reset/route";
import { POST as postEvent } from "../app/api/events/route";
import { EXAMPLE_CURSE, simulationHistory, DESIGNED_SPAMMERS } from "@/lib/fixtures";
import { getHost } from "@/lib/host";

const post = (url: string, body: unknown) =>
  new Request(`http://test${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const sim = (id: string, body?: unknown) => simulate(post(`/api/curses/${id}/simulate`, body ?? {}), { params: Promise.resolve({ id }) });

beforeEach(async () => {
  await reset();
  await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }));
});

describe("POST /api/curses/:id/simulate", () => {
  it("default fixture history: spam-strikes yields '3 muted, 0 false positives'", async () => {
    const res = await sim("spam-strikes");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summaryLine).toBe("3 muted, 0 false positives");
    expect(body.falsePositives).toEqual([]);
    expect([...body.report.summary.mutedTargets].sort()).toEqual([...DESIGNED_SPAMMERS].sort());
    expect(body.report.summary.byKind.escalate.taken).toBe(3);
    // spam-bo's 4th flagged message arrives while muted: suppressed, no decision.
    expect(body.report.suppressed.map((s: { author: string }) => s.author)).toEqual(["spam-bo"]);
    expect(body.report.decisions).toHaveLength(simulationHistory().length - 1);
  });

  it("leaves live chat state, decisions and grimoire byte-identical", async () => {
    for (let i = 0; i < 3; i++) await postEvent(post("/api/events", { author: "raid-bot", text: `spam ${i}`, flagged: true }));
    const host = getHost();
    const before = JSON.stringify({ chat: host.chat.snapshot(), now: host.chat.now, decisions: host.decisions, grimoire: host.grimoire.entries, suppressed: host.suppressed });
    expect(host.grimoire.entries.length).toBeGreaterThan(0);
    const res = await sim("spam-strikes");
    expect(res.status).toBe(200);
    const after = JSON.stringify({ chat: host.chat.snapshot(), now: host.chat.now, decisions: host.decisions, grimoire: host.grimoire.entries, suppressed: host.suppressed });
    expect(after).toBe(before);
  });

  it("accepts a custom event list", async () => {
    const T = Date.UTC(2026, 0, 1);
    const events = [1, 2, 3].map((n) => ({ id: `x${n}`, author: "zed", text: "buy", at: T + n, flagged: true }));
    const body = await (await sim("spam-strikes", { events })).json();
    expect(body.history).toBe("custom");
    expect(body.report.summary.mutedTargets).toEqual(["zed"]);
    expect(body.summaryLine).toBe("1 muted, 1 escalated, 0 posted, 0 emailed");
  });

  it("returns 404 for an unknown curse and 400 for bad events", async () => {
    expect((await sim("nope")).status).toBe(404);
    expect((await sim("spam-strikes", { events: "x" })).status).toBe(400);
    expect((await sim("spam-strikes", { events: [{ author: 1 }] })).status).toBe(400);
  });
});
