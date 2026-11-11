import { describe, expect, it } from "vitest";
import { POST as simulate } from "../app/api/curses/[id]/simulate/route";
import { getHost, refreshFixtures } from "@/lib/host";

const sim = (id: string) => simulate(new Request("http://test/x", { method: "POST", body: "{}" }), { params: Promise.resolve({ id }) });

describe("simulate", () => {
  it("over the fixture history does not touch the outbox, invoices, escalations or grimoire", async () => {
    refreshFixtures();
    const before = JSON.stringify([getHost().state.snapshot(), getHost().grimoire.entries, getHost().decisions]);
    for (const id of ["late-payers", "late-payers-firm", "late-payers-escalate"]) expect((await sim(id)).status).toBe(200);
    expect(JSON.stringify([getHost().state.snapshot(), getHost().grimoire.entries, getHost().decisions])).toBe(before);
    expect(getHost().state.outbox).toEqual([]);
  });

  it("reports the intended actions for the late-payers curse", async () => {
    refreshFixtures();
    const body = await (await sim("late-payers")).json();
    expect(body.summaryLine).toBe("4 emailed, 0 escalated");
    expect(body.report.intended.map((a: any) => a.template)).toEqual(["polite-nudge", "polite-nudge", "polite-nudge", "polite-nudge"]);
    const esc = await (await sim("late-payers-escalate")).json();
    expect(esc.summaryLine).toBe("0 emailed, 2 escalated");
  });

  it("returns 404 for an unknown curse", async () => {
    refreshFixtures();
    expect((await sim("nope")).status).toBe(404);
  });
});
