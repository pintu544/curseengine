import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postEvent, GET as getEvents } from "../app/api/events/route";
import { GET as getGrimoire } from "../app/api/grimoire/route";
import { POST as undo } from "../app/api/grimoire/[id]/undo/route";
import { GET as health } from "../app/api/health/route";
import { POST as postReset } from "../app/api/reset/route";
import { POST as postFixtures } from "../app/api/fixtures/route";
import { POST as postSimulate } from "../app/api/curses/[id]/simulate/route";
import { createMailAdapter } from "@/lib/adapter";
import { InvoiceState } from "@/lib/invoice-state";
import { DAY_MS, REFERENCE_NOW } from "@/lib/fixtures";
import { DeadbeatHost, engineEnabledFromEnv, EngineDisabledError, refreshFixtures, getHost } from "@/lib/host";

const post = (body?: unknown) =>
  new Request("http://test/api/events", { method: "POST", headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

let host: DeadbeatHost;
beforeEach(() => {
  host = refreshFixtures();
});
afterEach(() => {
  getHost().setEngineEnabled(undefined);
  delete process.env["CURSE_ENGINE_ENABLED"];
});

const snapshot = () => JSON.stringify({ state: host.state.snapshot(), decisions: host.decisions.length, grimoire: host.grimoire.entries.length });

describe("FR9 kill switch (Deadbeat)", () => {
  it("engine off: a tick (host and POST /api/events) returns disabled and produces no emails, escalations, decisions or grimoire entries", async () => {
    host.setEngineEnabled(false);
    const before = snapshot();
    await expect(host.advanceClock(1)).rejects.toBeInstanceOf(EngineDisabledError);
    const res = await postEvent(post({ days: 30 }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ disabled: true, killSwitch: "CURSE_ENGINE_ENABLED" });
    expect(body.message).toMatch(/disabled/);
    expect(snapshot()).toBe(before);
    expect(host.state.clock).toBe(REFERENCE_NOW);
    expect(host.state.outbox).toHaveLength(0);
    expect(host.state.escalations).toHaveLength(0);
    expect(host.grimoire.entries).toHaveLength(0);
    expect((await (await getGrimoire()).json()).entries).toHaveLength(0);
  });

  it("engine on: ticks behave normally, and toggling off then on resumes them", async () => {
    host.setEngineEnabled(false);
    await postEvent(post());
    expect(host.state.outbox).toHaveLength(0);
    host.setEngineEnabled(true);
    const res = await postEvent(post());
    expect(res.status).toBe(200);
    expect(host.state.outbox.filter((o) => o.curse === "late-payers").map((o) => o.invoiceId)).toEqual(["inv-002", "inv-003", "inv-004", "inv-005"]);
    expect(host.grimoire.entries.length).toBeGreaterThan(0);
  });

  it("the environment variable drives the switch (0, false, off disable) and /api/health reports it", async () => {
    for (const v of ["0", "false", "off", "Off"]) expect(engineEnabledFromEnv({ CURSE_ENGINE_ENABLED: v })).toBe(false);
    for (const v of [undefined, "1", "true"]) expect(engineEnabledFromEnv({ CURSE_ENGINE_ENABLED: v })).toBe(true);
    process.env["CURSE_ENGINE_ENABLED"] = "false";
    expect((await (await health()).json()).engineEnabled).toBe(false);
    expect((await postEvent(post())).status).toBe(503);
    expect(getHost().state.outbox).toHaveLength(0);
    delete process.env["CURSE_ENGINE_ENABLED"];
    expect((await (await health()).json()).engineEnabled).toBe(true);
  });

  it("engine off: reads and undo of earlier entries stay available and add nothing from intake", async () => {
    await host.advanceClock(1);
    const entry = host.grimoire.entries.find((e) => e.kind === "email")!;
    host.setEngineEnabled(false);
    const before = host.grimoire.entries.length;
    expect((await getEvents()).status).toBe(200);
    await postEvent(post());
    const res = await undo(new Request(`http://test/api/grimoire/${entry.id}/undo`, { method: "POST", body: "{}" }), { params: Promise.resolve({ id: entry.id }) });
    expect(res.status).toBe(200);
    expect(host.grimoire.entries).toHaveLength(before + 1);
  });

  it("flipping the switch during a multi-day advance never splits a day: finished days stay whole, the rest are skipped", async () => {
    const control = refreshFixtures();
    await control.advanceClock(2);
    const expected = JSON.stringify({ state: control.state.snapshot(), decisions: control.decisions.length, grimoire: control.grimoire.entries.length });
    host = refreshFixtures();
    const count = host.state.invoices.length;
    const real = (host as unknown as { intake: (...a: unknown[]) => Promise<unknown> }).intake.bind(host);
    let calls = 0;
    // Flip the switch off while day 2 is half way through (after its first invoice has ticked).
    vi.spyOn(host as unknown as { intake: (...a: unknown[]) => Promise<unknown> }, "intake").mockImplementation(async (...a: unknown[]) => {
      calls += 1;
      if (calls === count + 1) host.setEngineEnabled(false);
      return real(...a);
    });
    const result = await host.advanceClock(5);
    expect(result.interrupted).toBe(true);
    expect(result.days).toBe(2);
    expect(calls).toBe(count * 2);
    expect(host.state.clock).toBe(REFERENCE_NOW + 2 * DAY_MS);
    expect(JSON.stringify({ state: host.state.snapshot(), decisions: host.decisions.length, grimoire: host.grimoire.entries.length })).toBe(expected);
    // Off now: the next advance changes nothing at all.
    const before = snapshot();
    await expect(host.advanceClock(3)).rejects.toBeInstanceOf(EngineDisabledError);
    expect(snapshot()).toBe(before);
  });

  it("the override survives POST /api/reset and /api/fixtures: after a reset a tick still produces zero side effects", async () => {
    host.setEngineEnabled(false);
    for (const reset of [() => postReset(), () => postFixtures()]) {
      expect((await reset()).status).toBe(200);
      host = getHost();
      expect(host.engineEnabled).toBe(false);
      const before = snapshot();
      expect((await postEvent(post({ days: 7 }))).status).toBe(503);
      await expect(host.advanceClock(2)).rejects.toBeInstanceOf(EngineDisabledError);
      expect(snapshot()).toBe(before);
      expect(host.state.clock).toBe(REFERENCE_NOW);
      expect(host.state.outbox).toHaveLength(0);
      expect(host.state.escalations).toHaveLength(0);
      expect(host.grimoire.entries).toHaveLength(0);
    }
    host.setEngineEnabled(undefined);
    await postReset();
    expect(getHost().engineEnabled).toBe(true);
  });

  it("simulate while the engine is off still dry-runs and produces no side effects on live state", async () => {
    host.setEngineEnabled(false);
    const before = snapshot();
    const res = await postSimulate(new Request("http://test/api/curses/late-payers/simulate", { method: "POST", body: "{}" }), { params: Promise.resolve({ id: "late-payers" }) });
    expect(res.status).toBe(200);
    expect((await res.json()).report).toBeDefined();
    expect(snapshot()).toBe(before);
    expect(host.state.outbox).toHaveLength(0);
    expect(host.state.escalations).toHaveLength(0);
    expect(host.grimoire.entries).toHaveLength(0);
  });

  it("the dry-run capability set is derived from the adapter, not hard-coded", () => {
    const adapterKeys = Object.keys(createMailAdapter(new InvoiceState([], REFERENCE_NOW))).sort();
    expect([...host.declaredCapabilities()].sort()).toEqual(adapterKeys);
    expect(adapterKeys).toEqual(["email", "escalate"]);
    expect(new DeadbeatHost().declaredCapabilities().sort()).toEqual(adapterKeys);
  });
});
