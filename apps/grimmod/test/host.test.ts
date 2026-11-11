import { beforeEach, describe, expect, it } from "vitest";
import { parseCurse } from "@curseengine/engine";
import { burstMessages, EXAMPLE_CURSE, RAID_BOT } from "@/lib/fixtures";
import { GrimModHost } from "@/lib/host";

const T0 = Date.UTC(2025, 0, 1, 12, 0, 0);
const DAY = 86_400_000;

function msg(id: string, author: string, at: number, flagged: boolean, text = "hello") {
  return { id, author, channel: "general", text, at, flagged };
}

let host: GrimModHost;
beforeEach(() => {
  host = new GrimModHost(T0);
  host.install(parseCurse(EXAMPLE_CURSE));
});

describe("fixtures", () => {
  it("has stable ids and a flagged raid-bot author", () => {
    const a = new GrimModHost(T0).chat.messages.map((m) => m.id);
    const b = new GrimModHost(T0 + 999).chat.messages.map((m) => m.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    const bot = new GrimModHost(T0).chat.messages.filter((m) => m.author === RAID_BOT);
    expect(bot.length).toBeGreaterThan(0);
    expect(bot.every((m) => m.flagged)).toBe(true);
  });
  it("generates a burst of flagged raid-bot messages seconds apart", () => {
    const b = burstMessages(T0, 5, 2000);
    expect(b).toHaveLength(5);
    expect(b.every((m) => m.author === RAID_BOT && m.flagged)).toBe(true);
    expect(b[1]!.at - b[0]!.at).toBe(2000);
  });
});

describe("burst -> mute", () => {
  it("mutes the author exactly on the third flagged message, and escalates", async () => {
    const now = T0 + 60_000;
    const results = [];
    for (const m of burstMessages(now, 5)) results.push(await host.receive(m));

    expect(results[0]!.decisions[0]!.outcome).toBe("no-match");
    expect(results[1]!.decisions[0]!.outcome).toBe("no-match");
    expect(results[0]!.chat.mutes).toHaveLength(0);
    expect(results[1]!.chat.mutes).toHaveLength(0);

    const third = results[2]!;
    expect(third.decisions[0]!.outcome).toBe("executed");
    expect(third.decisions[0]!.conditions[0]!.observed).toBe(3);
    expect(third.chat.mutes).toHaveLength(1);
    expect(third.chat.mutes[0]!.author).toBe(RAID_BOT);
    expect(third.chat.escalations).toHaveLength(1);
    expect(third.chat.escalations[0]!.to).toBe("owner");
    expect(third.chat.escalations[0]!.eventId).toBe(third.message.id);

    // Messages four and five arrive while muted: suppressed, so no repeat mute or escalation.
    expect(results[3]!.message.muted).toBe(true);
    expect(results[3]!.decisions).toEqual([]);
    expect(results[4]!.chat.mutes).toHaveLength(1);
    expect(results[4]!.chat.escalations).toHaveLength(1);
  });

  it("does not count unflagged messages from the same author", async () => {
    for (let i = 0; i < 6; i++) await host.receive(msg(`u${i}`, RAID_BOT, T0 + i * 1000, false));
    await host.receive(msg("f1", RAID_BOT, T0 + 10_000, true));
    await host.receive(msg("f2", RAID_BOT, T0 + 11_000, true));
    expect(host.chat.isMuted(RAID_BOT)).toBe(false);
    const r = await host.receive(msg("f3", RAID_BOT, T0 + 12_000, true));
    expect(r.decisions[0]!.outcome).toBe("executed");
    expect(host.chat.isMuted(RAID_BOT)).toBe(true);
  });

  it("does not mix authors when counting", async () => {
    await host.receive(msg("a", "mira", T0, true));
    await host.receive(msg("b", "tobias", T0 + 1, true));
    await host.receive(msg("c", RAID_BOT, T0 + 2, true));
    expect(host.chat.mutes).toHaveLength(0);
    expect(host.chat.escalations).toHaveLength(0);
  });
});

describe("mute state in chat", () => {
  it("mutes for one day, marks later messages muted, then lifts", async () => {
    for (const m of burstMessages(T0, 3)) await host.receive(m);
    const mute = host.chat.mutes[0]!;
    expect(mute.until - mute.since).toBe(DAY);
    expect(host.chat.isMuted(RAID_BOT, T0 + 5000)).toBe(true);
    expect(host.chat.isMuted(RAID_BOT, mute.until)).toBe(false);
    expect(host.chat.isMuted("mira", T0 + 5000)).toBe(false);

    const after = await host.receive(msg("later", RAID_BOT, T0 + 10_000, false));
    expect(after.message.muted).toBe(true);
    const other = await host.receive(msg("other", "mira", T0 + 11_000, false));
    expect(other.message.muted).toBe(false);
  });

  it("the triggering message is stored unmuted; the mute applies from then on", async () => {
    const out = [];
    for (const m of burstMessages(T0, 4)) out.push(await host.receive(m));
    expect(out[2]!.message.muted).toBe(false);
    expect(out[3]!.message.muted).toBe(true);
  });
});

describe("sandbox", () => {
  it("records a failed decision, instead of throwing, for a curse that emails", async () => {
    host.install(parseCurse("curse mailer: when message -> email welcome to author"));
    const r = await host.receive(msg("m1", "mira", T0, false));
    const failed = r.decisions.find((d) => d.curse === "mailer")!;
    expect(failed.outcome).toBe("failed");
    expect(failed.actions[0]!.reason).toMatch(/undeclared capability "email"/);
    expect(r.message.id).toBe("m1");
  });

  it("keeps the failed record in the decision log", async () => {
    host.install(parseCurse("curse mailer: when message -> email welcome to author"));
    await host.receive(msg("m1", "mira", T0, false));
    expect(host.decisions.some((d) => d.curse === "mailer" && d.outcome === "failed" && d.eventId === "m1")).toBe(true);
  });

  it("still runs a good curse installed before and after the failing one", async () => {
    host.install(parseCurse('curse before: when message where text contains "hi" -> post "one" to general'));
    host.install(parseCurse("curse mailer: when message -> email welcome to author"));
    host.install(parseCurse('curse after: when message where text contains "hi" -> post "two" to general'));
    const r = await host.receive(msg("g1", "mira", T0, false, "hi there"));
    expect(r.decisions.map((d) => `${d.curse}:${d.outcome}`).sort()).toEqual(["after:executed", "before:executed", "mailer:failed", "spam-strikes:no-match"]);
    const posts = r.chat.messages.filter((m) => m.system).map((m) => m.text);
    expect(posts).toEqual(expect.arrayContaining(["one", "two"]));
  });

  it("keeps muting through the burst while a failing curse is installed", async () => {
    host.install(parseCurse("curse mailer: when message -> email welcome to author"));
    for (const m of burstMessages(T0, 3)) await host.receive(m);
    expect(host.chat.isMuted(RAID_BOT, T0 + 5000)).toBe(true);
    expect(host.decisions.filter((d) => d.curse === "mailer" && d.outcome === "failed")).toHaveLength(3);
  });

  it("runs a post action against chat state", async () => {
    host.install(parseCurse('curse greeter: when message where text contains "hi" -> post "welcome" to general'));
    const r = await host.receive(msg("g1", "mira", T0, false, "hi there"));
    expect(r.chat.messages.some((m) => m.system && m.text === "welcome")).toBe(true);
  });
});

describe("install after messages", () => {
  it("keeps count history when another curse is installed", async () => {
    await host.receive(msg("f1", RAID_BOT, T0, true));
    await host.receive(msg("f2", RAID_BOT, T0 + 1000, true));
    host.install(parseCurse('curse greeter: when message where text contains "hi" -> post "welcome" to general'));
    const r = await host.receive(msg("f3", RAID_BOT, T0 + 2000, true));
    const d = r.decisions.find((x) => x.curse === "spam-strikes")!;
    expect(d.conditions[0]!.observed).toBe(3);
    expect(d.outcome).toBe("executed");
    expect(host.chat.isMuted(RAID_BOT, T0 + 3000)).toBe(true);
  });

  it("keeps count history when the same curse is replaced", async () => {
    await host.receive(msg("f1", RAID_BOT, T0, true));
    await host.receive(msg("f2", RAID_BOT, T0 + 1000, true));
    host.install(parseCurse(EXAMPLE_CURSE));
    expect(host.getCurses()).toHaveLength(1);
    const r = await host.receive(msg("f3", RAID_BOT, T0 + 2000, true));
    expect(r.decisions[0]!.outcome).toBe("executed");
  });

  it("keeps quota usage when a curse is replaced", async () => {
    const small = new GrimModHost(T0, 1);
    const src = 'curse greeter: when message where text contains "hi" -> post "welcome" to general';
    small.install(parseCurse(src));
    expect((await small.receive(msg("a", "mira", T0, false, "hi"))).decisions[0]!.outcome).toBe("executed");
    small.install(parseCurse(src));
    expect((await small.receive(msg("b", "mira", T0 + 1000, false, "hi"))).decisions[0]!.outcome).toBe("skipped-quota");
  });
});

describe("monotonic host clock", () => {
  it("never rewinds on a backdated message and anchors mutes to the monotonic clock", async () => {
    await host.receive(msg("q1", "mira", T0 + 5000, true));
    await host.receive(msg("q2", "mira", T0 + 6000, true));
    expect(host.chat.now).toBe(T0 + 6000);

    const back = await host.receive(msg("q3", "mira", T0 + 1000, true)); // backdated
    expect(host.chat.now).toBe(T0 + 6000); // clock did not rewind
    expect(back.message.at).toBe(T0 + 6000); // treated as arriving now
    // The backdated event is counted at the clock (T0+6000), as the third strike, not at T0+1000.
    expect(back.decisions[0]!.at).toBe(T0 + 6000);
    expect(back.decisions[0]!.outcome).toBe("executed");
    expect(back.chat.mutes).toHaveLength(1);
    expect(back.chat.mutes[0]).toMatchObject({ author: "mira", since: T0 + 6000, until: T0 + 6000 + DAY });

    const later = await host.receive(msg("q4", "mira", T0 + 7000, true));
    expect(host.chat.now).toBe(T0 + 7000);
    expect(later.message.muted).toBe(true);
    expect(later.chat.mutes).toHaveLength(1);
  });
});
