import { beforeEach, describe, expect, it } from "vitest";
import { POST as postCurse } from "../app/api/curses/route";
import { GET as getGrimoire } from "../app/api/grimoire/route";
import { POST as undo } from "../app/api/grimoire/[id]/undo/route";
import { POST as postEvent } from "../app/api/events/route";
import { POST as reset } from "../app/api/reset/route";
import { EXAMPLE_CURSE } from "@/lib/fixtures";
import { getHost } from "@/lib/host";

const post = (url: string, body: unknown) =>
  new Request(`http://test${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const undoReq = (id: string) => undo(post(`/api/grimoire/${id}/undo`, {}), { params: Promise.resolve({ id }) });
const grimoire = async () => (await getGrimoire()).json();
const burst = async (n: number, author = "raid-bot") => {
  for (let i = 0; i < n; i++) await postEvent(post("/api/events", { author, text: `RAID ${i}`, flagged: true }));
};

beforeEach(async () => {
  await reset();
  await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }));
});

describe("grimoire", () => {
  it("records one entry per executed action, in order, with full detail", async () => {
    await burst(2);
    expect((await grimoire()).entries).toHaveLength(0);
    await burst(1);
    const { entries } = await grimoire();
    expect(entries.map((e: { kind: string }) => e.kind)).toEqual(["mute", "escalate"]);
    expect(entries[0]).toMatchObject({
      id: "g-000001", curse: "spam-strikes", kind: "mute", target: "raid-bot", status: "applied", reversible: true, reversed: false,
    });
    expect(entries[0].eventSummary).toContain("raid-bot");
    expect(entries[0].path).toContain("count(message by same author=raid-bot flagged) >= 3 within 7 days");
    expect(typeof entries[0].at).toBe("number");
    // exactly one entry per taken action
    const taken = getHost().decisions.flatMap((d) => d.actions).filter((a) => a.status === "taken").length;
    expect(entries).toHaveLength(taken);
  });

  it("Slice 1 storyline: burst -> mute -> undo from the grimoire unmutes and shows the reversal", async () => {
    await burst(3);
    const host = getHost();
    expect(host.chat.isMuted("raid-bot")).toBe(true);
    const before = (await grimoire()).entries;
    const mute = before.find((e: { kind: string }) => e.kind === "mute");
    const res = await undoReq(mute.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reversal).toMatchObject({ status: "reversed", reversalOf: mute.id, kind: "mute", target: "raid-bot" });
    expect(host.chat.isMuted("raid-bot")).toBe(false);
    expect(body.chat.mutes).toEqual([]);
    const after = (await grimoire()).entries;
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1).reversalOf).toBe(mute.id);
    // original entry intact (only the derived `reversed` flag changes)
    const { reversed, reversible, ...orig } = after[0];
    const { reversed: _r, reversible: _v, ...origBefore } = before[0];
    expect(orig).toEqual(origBefore);
    expect(reversed).toBe(true);
    expect(reversible).toBe(false);
    // the author can speak again, and the curse sees the message
    const next = await (await postEvent(post("/api/events", { author: "raid-bot", text: "back", flagged: false }))).json();
    expect(next.message.muted).toBe(false);
    expect(next.decisions.length).toBeGreaterThan(0);
  });

  it("messages from a muted author produce no decision and no entries; they are listed as suppressed", async () => {
    await burst(3);
    const host = getHost();
    const entries = host.grimoire.entries.length;
    const decisions = host.decisions.length;
    const res = await (await postEvent(post("/api/events", { author: "raid-bot", text: "still here", flagged: true }))).json();
    expect(res.message.muted).toBe(true);
    expect(res.decisions).toEqual([]);
    expect(host.decisions).toHaveLength(decisions);
    expect(host.grimoire.entries).toHaveLength(entries);
    const g = await grimoire();
    expect(g.suppressedTotal).toBe(1);
    expect(g.suppressedTruncated).toBe(false);
    expect(g.suppressed).toHaveLength(1);
    expect(g.suppressed[0]).toMatchObject({ author: "raid-bot" });
    expect(g.note).toMatch(/no decision and no grimoire entry/);
  });

  it("escalations can be undone too (retracted), and double undo is 409", async () => {
    await burst(3);
    const esc = (await grimoire()).entries.find((e: { kind: string }) => e.kind === "escalate");
    expect((await undoReq(esc.id)).status).toBe(200);
    expect(getHost().chat.escalations).toHaveLength(0);
    expect((await undoReq(esc.id)).status).toBe(409);
    const n = (await grimoire()).entries.length;
    const rev = (await grimoire()).entries.at(-1);
    expect((await undoReq(rev.id)).status).toBe(409);
    expect((await grimoire()).entries).toHaveLength(n);
  });

  it("returns 404 for an unknown entry", async () => {
    expect((await undoReq("g-999999")).status).toBe(404);
  });
});

describe("suppressed list bound", () => {
  it("returns an exact total but at most the latest 50 suppressed entries", async () => {
    await burst(3); // third flagged message mutes raid-bot for a day
    for (let i = 0; i < 60; i++) await postEvent(post("/api/events", { author: "raid-bot", text: `while muted ${i}`, flagged: true }));
    const g = await grimoire();
    expect(g.suppressedTotal).toBe(60);
    expect(g.suppressed.length).toBeLessThanOrEqual(50);
    expect(g.suppressed).toHaveLength(50);
    expect(g.suppressedTruncated).toBe(true);
    expect(g.suppressed.at(-1).eventId).toBe(getHost().suppressed.at(-1)!.eventId);
    expect(g.suppressed[0].eventId).toBe(getHost().suppressed[10]!.eventId);
    expect(getHost().suppressed).toHaveLength(60);
  });
});
