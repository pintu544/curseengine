import { beforeEach, describe, expect, it } from "vitest";
import { DAY_MS, REFERENCE_NOW } from "@/lib/fixtures";
import { refreshFixtures } from "@/lib/host";
import { viewOf } from "@/lib/grimoire";
import type { DeadbeatHost } from "@/lib/host";

let host: DeadbeatHost;
beforeEach(() => {
  host = refreshFixtures();
});

const outboxFor = (curse: string) => host.state.outbox.filter((o) => o.curse === curse);

describe("fixture clock", () => {
  it("starts at the reference clock with invoices 3, 8, 15, 22 and 40 days overdue", () => {
    expect(host.state.clock).toBe(REFERENCE_NOW);
    expect(host.state.invoices.map((i) => i.daysOverdue)).toEqual([3, 8, 15, 22, 40]);
  });
});

describe("tier 1 (late-payers, >= 7 days)", () => {
  it("advancing one day puts exactly the >= 7-day invoices' tier-1 emails in the outbox and nothing for the 3-day invoice", async () => {
    await host.advanceClock(1);
    const tier1 = outboxFor("late-payers");
    expect(tier1.map((o) => o.invoiceId)).toEqual(["inv-002", "inv-003", "inv-004", "inv-005"]);
    expect(tier1.every((o) => o.template === "polite-nudge" && o.to.endsWith(".invalid") && !o.retracted)).toBe(true);
    expect(host.state.outbox.filter((o) => o.invoiceId === "inv-001")).toEqual([]);
    expect(host.state.invoices[0]?.daysOverdue).toBe(4);
    expect(host.state.clock).toBe(REFERENCE_NOW + DAY_MS);
  });

  it("a second tick on the same day produces no duplicate emails, decisions marked taken or grimoire entries", async () => {
    await host.advanceClock(1);
    const outbox = host.state.outbox.length;
    const entries = host.grimoire.entries.length;
    const again = await host.advanceClock(0);
    expect(again.decisions.some((d) => d.actions.some((a) => a.status === "taken"))).toBe(false);
    expect(host.state.outbox).toHaveLength(outbox);
    expect(host.grimoire.entries).toHaveLength(entries);
    expect(host.state.escalations).toHaveLength(2);
  });
});

describe("tiers 2 and 3 across later days", () => {
  it("fires tier 2 once when 14 days is crossed and tier 3 (escalation) once when 21 is crossed", async () => {
    await host.advanceClock(1); // inv-002 is now 9 days overdue; only tier 1 so far
    const forInv2 = () => host.state.outbox.filter((o) => o.invoiceId === "inv-002").map((o) => o.curse);
    expect(forInv2()).toEqual(["late-payers"]);
    expect(host.state.escalations.filter((e) => e.invoiceId === "inv-002")).toEqual([]);

    await host.advanceClock(4); // 13 days
    expect(forInv2()).toEqual(["late-payers"]);
    await host.advanceClock(1); // 14 days: tier 2
    expect(forInv2()).toEqual(["late-payers", "late-payers-firm"]);
    expect(host.state.outbox.find((o) => o.curse === "late-payers-firm" && o.invoiceId === "inv-002")?.template).toBe("firm-reminder");

    await host.advanceClock(6); // 20 days
    expect(host.state.escalations.filter((e) => e.invoiceId === "inv-002")).toEqual([]);
    await host.advanceClock(1); // 21 days: tier 3
    const esc = host.state.escalations.filter((e) => e.invoiceId === "inv-002");
    expect(esc).toHaveLength(1);
    expect(esc[0]?.curse).toBe("late-payers-escalate");
    expect(host.grimoire.entries.filter((e) => e.kind === "escalate" && e.target === "owner" && e.eventId.endsWith("inv-002"))).toHaveLength(1);

    // Many more days: still exactly once each.
    await host.advanceClock(30);
    expect(forInv2()).toEqual(["late-payers", "late-payers-firm"]);
    expect(host.state.escalations.filter((e) => e.invoiceId === "inv-002")).toHaveLength(1);
  });

  it("sends each tier at most once per invoice across many ticks", async () => {
    await host.advanceClock(60);
    for (const inv of host.state.invoices.filter((i) => i.id !== "inv-001" || i.daysOverdue >= 7)) {
      const mails = host.state.outbox.filter((o) => o.invoiceId === inv.id);
      expect(new Set(mails.map((m) => m.curse)).size).toBe(mails.length);
    }
    expect(outboxFor("late-payers")).toHaveLength(5);
    expect(outboxFor("late-payers-firm")).toHaveLength(5);
    expect(host.state.escalations).toHaveLength(5);
    expect(host.grimoire.entries).toHaveLength(15);
  });
});

describe("clock rules", () => {
  it("only moves forward, whole days, within the bound", async () => {
    await expect(host.advanceClock(-1)).rejects.toThrow(RangeError);
    await expect(host.advanceClock(1.5)).rejects.toThrow(RangeError);
    await expect(host.advanceClock(1000)).rejects.toThrow(RangeError);
    expect(host.state.clock).toBe(REFERENCE_NOW);
  });
});

describe("undo", () => {
  it("marks the outbox entry retracted, keeps it, appends a reversal entry and does not re-send the tier", async () => {
    await host.advanceClock(1);
    const entry = host.grimoire.entries.find((e) => e.kind === "email" && e.curse === "late-payers")!;
    expect(viewOf(host.grimoire).find((v) => v.id === entry.id)?.reversible).toBe(true);
    const before = host.grimoire.entries.length;
    const rev = host.undo(entry.id);
    expect(rev.status).toBe("reversed");
    expect(rev.reversalOf).toBe(entry.id);
    expect(host.grimoire.entries).toHaveLength(before + 1);
    expect(host.grimoire.get(entry.id)?.status).toBe("applied");
    const out = host.state.outbox.find((o) => o.id === entry.ref)!;
    expect(out.retracted).toBe(true);
    expect(host.state.outbox.some((o) => o.id === entry.ref)).toBe(true);
    expect(viewOf(host.grimoire).find((v) => v.id === entry.id)).toMatchObject({ reversed: true, reversible: false });

    await host.advanceClock(1);
    expect(outboxFor("late-payers").filter((o) => o.invoiceId === out.invoiceId)).toHaveLength(1);
  });

  it("retracts an escalation the same way", async () => {
    await host.advanceClock(1);
    const entry = host.grimoire.entries.find((e) => e.kind === "escalate")!;
    host.undo(entry.id);
    expect(host.state.escalations.find((e) => e.id === entry.ref)?.retracted).toBe(true);
  });
});

describe("user curses", () => {
  it("never sends a real message: the adapter only declares email and escalate, so mute/post curses are refused", async () => {
    const { parseCurse } = await import("@curseengine/engine");
    host.install(parseCurse("curse noisy: every 1 day -> post \"hi\" to general"));
    const res = await host.advanceClock(1);
    expect(res.decisions.some((d) => d.curse === "noisy" && d.outcome === "failed")).toBe(true);
  });
});

describe("audit-write ordering", () => {
  it("records a grimoire entry for every effect already applied when the pass throws a non-capability error", async () => {
    // Inject a failure AFTER the executor has applied its effects for the first invoice's tick.
    const ex = (host as unknown as { executor: { handle(e: unknown): Promise<unknown> } }).executor;
    const real = ex.handle.bind(ex);
    let calls = 0;
    ex.handle = async (e) => {
      const out = await real(e);
      // inv-001 (4 days overdue) matches nothing; the second tick (inv-002) is the first that sends.
      if (++calls === 2) throw new Error("injected mid-pass failure");
      return out;
    };
    await expect(host.advanceClock(1)).rejects.toThrow("injected mid-pass failure");

    expect(host.state.outbox.length).toBeGreaterThan(0);
    const taken = host.decisions.flatMap((d) => d.actions).filter((a) => a.status === "taken").length;
    expect(taken).toBeGreaterThan(0);
    expect(host.grimoire.entries).toHaveLength(taken);
    expect(host.grimoire.entries.filter((e) => e.kind === "email")).toHaveLength(host.state.outbox.length);
    expect(host.state.hasSent("inv-002", "late-payers")).toBe(true);
  });
});
