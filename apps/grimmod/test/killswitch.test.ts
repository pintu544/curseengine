import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as postCurse } from "../app/api/curses/route";
import { GET as getGrimoire } from "../app/api/grimoire/route";
import { POST as undo } from "../app/api/grimoire/[id]/undo/route";
import { POST as postEvent } from "../app/api/events/route";
import { GET as health } from "../app/api/health/route";
import { POST as reset } from "../app/api/reset/route";
import { POST as postFixtures } from "../app/api/fixtures/route";
import { POST as postSimulate } from "../app/api/curses/[id]/simulate/route";
import { createChatAdapter } from "@/lib/adapter";
import { ChatState } from "@/lib/chat-state";
import { EXAMPLE_CURSE } from "@/lib/fixtures";
import { engineEnabledFromEnv, EngineDisabledError, getHost } from "@/lib/host";

const post = (url: string, body: unknown) =>
  new Request(`http://test${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const burst = (n: number, author = "raid-bot") => {
  const out: Response[] = [];
  return (async () => {
    for (let i = 0; i < n; i++) out.push(await postEvent(post("/api/events", { author, text: `RAID ${i}`, flagged: true })));
    return out;
  })();
};

beforeEach(async () => {
  await reset();
  await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }));
});
afterEach(() => {
  getHost().setEngineEnabled(undefined);
  delete process.env["CURSE_ENGINE_ENABLED"];
});

describe("FR9 kill switch (GrimMod)", () => {
  it("engine off: a raid burst returns 503 and produces no decisions, mutes, escalations, messages or grimoire entries", async () => {
    const host = getHost();
    host.setEngineEnabled(false);
    const before = JSON.stringify(host.chat.snapshot());
    const responses = await burst(5);
    expect(responses.map((r) => r.status)).toEqual([503, 503, 503, 503, 503]);
    const body = await responses[0]!.json();
    expect(body).toMatchObject({ disabled: true, killSwitch: "CURSE_ENGINE_ENABLED" });
    expect(body.message).toMatch(/disabled/);
    expect(host.decisions).toHaveLength(0);
    expect(host.grimoire.entries).toHaveLength(0);
    expect(host.suppressed).toHaveLength(0);
    expect(host.chat.mutes).toHaveLength(0);
    expect(host.chat.escalations).toHaveLength(0);
    expect(JSON.stringify(host.chat.snapshot())).toBe(before);
    expect((await (await getGrimoire()).json()).entries).toHaveLength(0);
  });

  it("engine off: host.receive throws EngineDisabledError before touching anything", async () => {
    const host = getHost();
    host.setEngineEnabled(false);
    await expect(host.receive({ id: "x", author: "a", channel: "general", text: "hi", at: host.chat.now + 1, flagged: true })).rejects.toBeInstanceOf(EngineDisabledError);
    expect(host.chat.messages.some((m) => m.id === "x")).toBe(false);
  });

  it("engine on: normal behaviour (mute on the third flagged message), and toggling off then on resumes it", async () => {
    const host = getHost();
    host.setEngineEnabled(false);
    await burst(3);
    expect(host.grimoire.entries).toHaveLength(0);
    host.setEngineEnabled(true);
    const responses = await burst(3);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(host.grimoire.entries.map((e) => e.kind)).toEqual(["mute", "escalate"]);
    expect(host.chat.mutes.map((m) => m.author)).toEqual(["raid-bot"]);
  });

  it("the environment variable drives the switch (0, false, off disable; anything else enables) and /api/health reports it", async () => {
    for (const v of ["0", "false", "off", "OFF"]) expect(engineEnabledFromEnv({ CURSE_ENGINE_ENABLED: v })).toBe(false);
    for (const v of [undefined, "1", "true", "on"]) expect(engineEnabledFromEnv({ CURSE_ENGINE_ENABLED: v })).toBe(true);
    process.env["CURSE_ENGINE_ENABLED"] = "off";
    expect((await (await health()).json()).engineEnabled).toBe(false);
    expect((await burst(3)).map((r) => r.status)).toEqual([503, 503, 503]);
    expect(getHost().grimoire.entries).toHaveLength(0);
    process.env["CURSE_ENGINE_ENABLED"] = "1";
    expect((await (await health()).json()).engineEnabled).toBe(true);
  });

  it("engine off: undo of an earlier entry still works, and nothing new is recorded by intake", async () => {
    const host = getHost();
    await burst(3);
    const entry = host.grimoire.entries[0]!;
    host.setEngineEnabled(false);
    await burst(2);
    const res = await undo(post(`/api/grimoire/${entry.id}/undo`, {}), { params: Promise.resolve({ id: entry.id }) });
    expect(res.status).toBe(200);
    expect(host.grimoire.entries).toHaveLength(3);
    expect(host.grimoire.isReversed(entry.id)).toBe(true);
  });

  it("the override survives POST /api/reset and /api/fixtures: after a reset a raid burst still produces zero side effects", async () => {
    getHost().setEngineEnabled(false);
    for (const doReset of [() => reset(), () => postFixtures()]) {
      expect((await doReset()).status).toBe(200);
      const host = getHost();
      expect(host.engineEnabled).toBe(false);
      const before = JSON.stringify(host.chat.snapshot());
      expect((await burst(5)).map((r) => r.status)).toEqual([503, 503, 503, 503, 503]);
      expect(host.decisions).toHaveLength(0);
      expect(host.grimoire.entries).toHaveLength(0);
      expect(host.chat.mutes).toHaveLength(0);
      expect(host.chat.escalations).toHaveLength(0);
      expect(JSON.stringify(host.chat.snapshot())).toBe(before);
    }
    getHost().setEngineEnabled(undefined);
    await reset();
    expect(getHost().engineEnabled).toBe(true);
  });

  it("simulate while the engine is off still dry-runs and produces no side effects on live state", async () => {
    const host = getHost();
    host.setEngineEnabled(false);
    const before = JSON.stringify(host.chat.snapshot());
    const res = await postSimulate(post("/api/curses/x/simulate", {}), { params: Promise.resolve({ id: host.getCurses()[0]!.name }) });
    expect(res.status).toBe(200);
    expect((await res.json()).report).toBeDefined();
    expect(JSON.stringify(host.chat.snapshot())).toBe(before);
    expect(host.decisions).toHaveLength(0);
    expect(host.grimoire.entries).toHaveLength(0);
    expect(host.chat.mutes).toHaveLength(0);
  });

  it("the dry-run capability set is derived from the adapter, not hard-coded", () => {
    const adapterKeys = Object.keys(createChatAdapter(new ChatState([]))).sort();
    expect([...getHost().declaredCapabilities()].sort()).toEqual(adapterKeys);
    expect(adapterKeys).toEqual(["escalate", "mute", "post"]);
  });
});
