import { describe, expect, it } from "vitest";
import { POST as refresh } from "../app/api/fixtures/route";
import { DAY_MS, fixtureInvoices, REFERENCE_NOW } from "@/lib/fixtures";
import { getHost } from "@/lib/host";

describe("fixture contract", () => {
  it("has stable unique ids, fields for the email target and the reference clock", () => {
    const a = fixtureInvoices();
    expect(a.map((i) => i.id)).toEqual(["inv-001", "inv-002", "inv-003", "inv-004", "inv-005"]);
    expect(new Set(a.map((i) => i.clientId)).size).toBe(a.length);
    expect(a.every((i) => i.clientEmail.endsWith(".invalid") && i.amount > 0 && i.clientName)).toBe(true);
    expect(JSON.stringify(fixtureInvoices())).toBe(JSON.stringify(a));
    expect(REFERENCE_NOW).toBe(Date.UTC(2026, 10, 11, 12));
    expect(DAY_MS).toBe(86_400_000);
  });

  it("refreshing twice gives identical state, and refresh discards live activity", async () => {
    const r1 = await (await refresh()).json();
    expect(r1.reset).toBe(true);
    expect(r1.curses).toEqual(["late-payers", "late-payers-firm", "late-payers-escalate"]);
    await getHost().advanceClock(3);
    expect(getHost().state.outbox.length).toBeGreaterThan(0);
    const r2 = await (await refresh()).json();
    expect(JSON.stringify(r2)).toBe(JSON.stringify(r1));
    expect(getHost().grimoire.entries).toEqual([]);
    expect(getHost().decisions).toEqual([]);
  });
});
