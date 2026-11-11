import { beforeEach, describe, expect, it } from "vitest";
import { POST as postCurse } from "../app/api/curses/route";
import { GET as getGraph } from "../app/api/curses/[id]/graph/route";
import { POST as simulate } from "../app/api/curses/[id]/simulate/route";
import { GET as getEvents, POST as postEvent } from "../app/api/events/route";
import { GET as getGrimoire } from "../app/api/grimoire/route";
import { POST as undo } from "../app/api/grimoire/[id]/undo/route";
import { GET as health } from "../app/api/health/route";
import { POST as reset } from "../app/api/reset/route";
import { EXAMPLE_CURSE, LATE_PAYERS_ESCALATE_CURSE, LATE_PAYERS_FIRM_CURSE } from "@/lib/fixtures";

const post = (url: string, body?: unknown) =>
  new Request(`http://test${url}`, { method: "POST", headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(async () => {
  await reset();
});

describe("POST /api/curses", () => {
  it("returns 201 {id, graph} for a valid curse", async () => {
    const res = await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("late-payers");
    expect(body.graph.nodes).toHaveLength(3);
  });

  it("returns 422 {line, message} with the exact line for invalid source", async () => {
    const res = await postCurse(post("/api/curses", { source: "curse bad:\n  every 1 day\n  -> explode owner" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.line).toBe(3);
    expect(body.message).toMatch(/expected an action.*"explode"/);
  });

  it("returns 422 when source is missing", async () => {
    expect((await postCurse(post("/api/curses", {}))).status).toBe(422);
  });
});

describe("GET /api/curses/:id/graph", () => {
  it("returns the stored graph, or 404", async () => {
    await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }));
    const ok = await getGraph(new Request("http://test/x"), params("late-payers"));
    expect(ok.status).toBe(200);
    expect((await ok.json()).graph.name).toBe("late-payers");
    expect((await getGraph(new Request("http://test/x"), params("nope"))).status).toBe(404);
  });
});

describe("POST /api/events (clock tick)", () => {
  it("advances one day by default and puts the tier-1 emails in the outbox", async () => {
    await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }));
    const res = await postEvent(post("/api/events"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outbox.map((o: any) => o.invoiceId)).toEqual(["inv-002", "inv-003", "inv-004", "inv-005"]);
    expect(body.invoices.map((i: any) => i.daysOverdue)).toEqual([4, 9, 16, 23, 41]);
    expect(body.invoices[0].status).toBe("open");
    expect(body.invoices[1].status).toBe("chased");
    const state = await (await getEvents()).json();
    expect(state.outbox).toHaveLength(4);
    expect(state.curses).toEqual(["late-payers"]);
    expect(state.clock).toBe(body.clock);
  });

  it("a repeated tick on the same day (days 0) adds nothing", async () => {
    await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }));
    await postEvent(post("/api/events", { days: 1 }));
    const again = await (await postEvent(post("/api/events", { days: 0 }))).json();
    expect(again.outbox).toHaveLength(4);
  });

  it("fires tiers 2 and 3 once each when the thresholds are crossed", async () => {
    for (const source of [EXAMPLE_CURSE, LATE_PAYERS_FIRM_CURSE, LATE_PAYERS_ESCALATE_CURSE]) await postCurse(post("/api/curses", { source }));
    await postEvent(post("/api/events", { days: 1 }));
    const last = await (await postEvent(post("/api/events", { days: 30 }))).json();
    expect(last.escalations.filter((e: any) => e.invoiceId === "inv-002")).toHaveLength(1);
    expect(last.outbox.filter((o: any) => o.curse === "late-payers-firm")).toHaveLength(5);
  });

  it("rejects bad input with 400", async () => {
    for (const body of ['{"days": -1}', '{"days": 1.5}', '{"days": "x"}', '{"days": 9999}', "not json", "[1]"]) {
      expect((await postEvent(post("/api/events", body))).status, body).toBe(400);
    }
  });
});

describe("simulate over the API", () => {
  it("leaves the outbox untouched", async () => {
    await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }));
    const res = await simulate(post("/api/curses/late-payers/simulate", {}), params("late-payers"));
    expect(res.status).toBe(200);
    expect((await res.json()).summaryLine).toBe("4 emailed, 0 escalated");
    expect((await (await getEvents()).json()).outbox).toEqual([]);
  });
});

describe("grimoire and undo", () => {
  it("lists reversible email entries and undo marks the outbox entry retracted with a reversal entry", async () => {
    await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }));
    await postEvent(post("/api/events"));
    const g = await (await getGrimoire()).json();
    expect(g.entries).toHaveLength(4);
    expect(g.entries.every((e: any) => e.kind === "email" && e.reversible)).toBe(true);

    const res = await undo(post("/x"), params(g.entries[0].id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reversal.reversalOf).toBe(g.entries[0].id);
    expect(body.state.outbox[0].retracted).toBe(true);
    expect(body.state.outbox).toHaveLength(4);
    const after = await (await getGrimoire()).json();
    expect(after.entries).toHaveLength(5);
    expect(after.entries[0].reversed).toBe(true);

    expect((await undo(post("/x"), params(g.entries[0].id))).status).toBe(409);
    expect((await undo(post("/x"), params("g-999999"))).status).toBe(404);
  });
});

describe("POST /api/reset", () => {
  it("says what it did, and removes curses, outbox, grimoire and clock movement", async () => {
    await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }));
    const fresh = await (await getEvents()).json();
    await postEvent(post("/api/events"));
    const res = await reset();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reset).toBe(true);
    expect(body.note).toMatch(/Restored the fixture invoices.*Removed all installed curses.*outbox.*grimoire/);
    const state = await (await getEvents()).json();
    expect(state.curses).toEqual([]);
    expect(state.outbox).toEqual([]);
    expect(state.latest).toBeNull();
    expect(state.clock).toBe(fresh.clock);
    expect(state.invoices.map((i: any) => i.daysOverdue)).toEqual([3, 8, 15, 22, 40]);
    expect((await (await getGrimoire()).json()).entries).toEqual([]);
  });
});

describe("GET /api/health", () => {
  it("is ok", async () => {
    expect(await (await health()).json()).toEqual({ ok: true, app: "deadbeat", engineEnabled: true });
  });
});
