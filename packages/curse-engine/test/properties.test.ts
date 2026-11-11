/**
 * Property-based tests (fast-check). The project's PBT centrepiece:
 *   PARITY                      simulator decision records equal live executor decision records
 *   INVARIANT (a) DRY-RUN PURITY
 *   INVARIANT (b) UNDO RESTORATION
 *   INVARIANT (c) AUDIT COMPLETENESS/ORDER
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  AlreadyReversedError, AuditLog, createExecutor, parseCurse, simulate,
  type Capabilities, type Curse, type DecisionRecord, type EngineEvent, type Inverse,
} from "../src/index.js";

/** Number of generated cases for the parity property (requirement: at least 1,000). */
export const PARITY_RUNS = 1500;
const INVARIANT_RUNS = 300;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const BASE = 1_700_000_000_000;

const CURSES: Curse[] = [
  "curse spam-strikes: when message where count(message by same author flagged) >= 3 within 7 days -> mute author for 1 day; escalate to owner",
  'curse free-gift: when message where text contains "FREE" -> post "no spam please" to general',
  'curse rx-or-hot: when message where text matches "buy.*now" or score > 5 -> post "hmm" to general',
  "curse hot-score: when message where score >= 7 -> mute author for 2 hours; escalate to owner",
  "curse burst: when message where count(message flagged) >= 2 within 1 hour and channel = general -> mute author for 30 minutes; escalate to owner",
  "curse reporter-mute: when message where flagged = true -> mute reporter for 1 hour",
].map((s) => parseCurse(s));

const AUTHORS = ["amy", "bob", "cy", "dee"];
const TEXTS = ["hello there", "FREE gift cards", "buy it now please", "ok", "FREE and buy now"];

const eventsArb = fc
  .array(
    fc.record({
      // Offsets deliberately unordered: includes backdated events and equal timestamps.
      offset: fc.oneof(fc.integer({ min: 0, max: 10 * DAY }), fc.integer({ min: 0, max: 5 })),
      author: fc.option(fc.constantFrom(...AUTHORS), { nil: undefined }),
      text: fc.constantFrom(...TEXTS),
      flagged: fc.boolean(),
      score: fc.option(fc.integer({ min: 0, max: 10 }), { nil: undefined }),
      channel: fc.constantFrom("general", "random"),
    }),
    { maxLength: 40 },
  )
  .map((rows): EngineEvent[] =>
    rows.map((r, i) => ({
      id: `e${i}`,
      type: "message",
      at: BASE + r.offset,
      flagged: r.flagged,
      fields: {
        ...(r.author !== undefined ? { author: r.author } : {}),
        text: r.text,
        channel: r.channel,
        flagged: r.flagged,
        ...(r.score !== undefined ? { score: r.score } : {}),
      },
    })),
  );
const cursesArb = fc.subarray(CURSES, { minLength: 1 });
const quotaArb = fc.integer({ min: 1, max: 6 });

/** Independent "live host" model: its own Executor, its own stub capabilities, driven event by event. */
async function liveRun(curses: Curse[], events: EngineEvent[], quota: number): Promise<DecisionRecord[]> {
  let now = -Infinity;
  // Like the real ChatState: every mute is kept, and an author is muted while ANY mute still covers the clock.
  // (Regression: a last-write-wins map let a later 30-minute mute shorten an earlier 1-day mute.)
  const mutes: { author: string; until: number }[] = [];
  const caps: Capabilities = {
    mute: (r) => void mutes.push({ author: r.target, until: now + r.durationMs }),
    post: () => {},
    email: () => {},
    escalate: () => {},
  };
  const ex = createExecutor({ curses, capabilities: caps, quotaPerHour: quota });
  const out: DecisionRecord[] = [];
  for (const raw of events) {
    now = Math.max(now, raw.at);
    const author = raw.fields["author"];
    if (author !== undefined && mutes.some((m) => m.author === String(author) && now < m.until)) continue;
    out.push(...(await ex.handle({ ...raw, at: now })));
  }
  return out;
}

describe("PARITY: simulator decision records equal live executor decision records", () => {
  it(`holds for ${PARITY_RUNS} generated event streams with zero divergences`, async () => {
    let cases = 0;
    let divergences = 0;
    await fc.assert(
      fc.asyncProperty(cursesArb, eventsArb, quotaArb, async (curses, events, quota) => {
        cases++;
        const live = await liveRun(curses, events, quota);
        const sim = await simulate({ curses, events, quotaPerHour: quota });
        try { expect(sim.decisions).toEqual(live); } catch (e) { divergences++; throw e; }
      }),
      { numRuns: PARITY_RUNS },
    );
    expect(cases).toBe(PARITY_RUNS);
    expect(divergences).toBe(0);
    console.log(`PARITY: ${cases} generated cases run, ${divergences} divergences`);
  });
});

describe("INVARIANT (a) DRY-RUN PURITY", () => {
  it("simulation makes zero calls on a real host adapter and leaves host state unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(cursesArb, eventsArb, quotaArb, async (curses, events, quota) => {
        const hostState = { mutes: [{ author: "zed", until: 1 }], posts: [] as string[], escalations: [] as string[] };
        const before = structuredClone(hostState);
        let calls = 0;
        const realAdapter: Capabilities = {
          mute: () => { calls++; hostState.mutes.push({ author: "x", until: 0 }); },
          post: () => { calls++; hostState.posts.push("x"); },
          email: () => { calls++; },
          escalate: () => { calls++; hostState.escalations.push("x"); },
        };
        // Even a caller who smuggles an adapter into the options cannot make simulate() use it.
        await simulate({ curses, events, quotaPerHour: quota, capabilities: realAdapter, adapter: realAdapter } as never);
        expect(calls).toBe(0);
        expect(hostState).toEqual(before);
      }),
      { numRuns: INVARIANT_RUNS },
    );
  });

  it("the simulate signature takes a single options object with no adapter parameter", () => {
    expect(simulate.length).toBe(1);
  });
});

/** A host-like state with forward capabilities that tag every effect with a ref, and exact inverses. */
function makeHost() {
  const state = {
    mutes: [{ ref: "pre-1", author: "amy", until: BASE + 99 * DAY }] as { ref: string; author: string; until: number }[],
    posts: [] as { ref: string; channel: string; message: string }[],
    escalations: [] as { ref: string; eventId: string }[],
  };
  let seq = 0;
  let now = BASE;
  let refs: string[] = [];
  const caps: Capabilities = {
    mute: (r) => { const ref = `fx-${++seq}`; refs.push(ref); state.mutes.push({ ref, author: r.target, until: now + r.durationMs }); },
    post: (r) => { const ref = `fx-${++seq}`; refs.push(ref); state.posts.push({ ref, channel: r.channel, message: r.message }); },
    email: () => { refs.push(`fx-${++seq}`); },
    escalate: (r) => { const ref = `fx-${++seq}`; refs.push(ref); state.escalations.push({ ref, eventId: r.eventId }); },
  };
  const inverse: Inverse = {
    mute: (e) => { state.mutes = state.mutes.filter((m) => m.ref !== e.ref); },
    post: (e) => { state.posts = state.posts.filter((p) => p.ref !== e.ref); },
    escalate: (e) => { state.escalations = state.escalations.filter((x) => x.ref !== e.ref); },
  };
  return {
    state, caps, inverse,
    setNow: (n: number) => { now = n; },
    takeRefs: () => { const r = refs; refs = []; return r; },
  };
}

/** Executes the stream through a live executor, logging each decision. Returns per-step log lengths. */
async function execute(curses: Curse[], events: EngineEvent[], quota: number) {
  const host = makeHost();
  const log = new AuditLog();
  const ex = createExecutor({ curses, capabilities: host.caps, quotaPerHour: quota });
  const steps: { events: number; taken: number; entries: number }[] = [];
  let taken = 0;
  let now = -Infinity;
  const order: string[] = [];
  for (const raw of events) {
    now = Math.max(now, raw.at);
    host.setNow(now);
    const recs = await ex.handle({ ...raw, at: now });
    const refs = host.takeRefs();
    let k = 0;
    for (const rec of recs) {
      const n = rec.actions.filter((a) => a.status === "taken").length;
      log.recordDecision(rec, `message ${raw.id}`, refs.slice(k, k + n));
      for (let j = 0; j < n; j++) order.push(raw.id);
      k += n;
      taken += n;
    }
    steps.push({ events: order.length, taken, entries: log.entries.length });
  }
  return { host, log, steps, order, taken };
}

const reversible = (e: { kind: string }) => e.kind !== "email";

describe("INVARIANT (b) UNDO RESTORATION", () => {
  it("execute then undo returns the host to the exact prior snapshot (reverse and forward undo order)", async () => {
    await fc.assert(
      fc.asyncProperty(cursesArb, eventsArb, quotaArb, fc.boolean(), async (curses, events, quota, reverseOrder) => {
        const fresh = makeHost();
        const prior = structuredClone(fresh.state);
        const { host, log } = await execute(curses, events, quota);
        const originals = log.entries.filter((e) => e.status === "applied" && reversible(e));
        for (const e of reverseOrder ? [...originals].reverse() : originals) log.reverse(e.id, host.inverse, e.at);
        expect(host.state).toEqual(prior);
      }),
      { numRuns: INVARIANT_RUNS },
    );
  });
});

describe("INVARIANT (c) AUDIT COMPLETENESS/ORDER", () => {
  it("one entry per executed action, in event order, append-only; undo appends a reversal", async () => {
    await fc.assert(
      fc.asyncProperty(cursesArb, eventsArb, quotaArb, fc.array(fc.nat(), { maxLength: 8 }), async (curses, events, quota, picks) => {
        const { host, log, steps, order, taken } = await execute(curses, events, quota);
        // exactly one entry per taken action, aligned step by step
        for (const s of steps) expect(s.entries).toBe(s.taken);
        expect(log.entries).toHaveLength(taken);
        expect(log.entries.map((e) => e.eventId)).toEqual(order);
        expect(log.entries.map((e) => e.seq)).toEqual(log.entries.map((_, i) => i + 1));
        expect(log.entries.every((e) => e.status === "applied" && e.reversalOf === undefined)).toBe(true);
        // event order: entry event indexes never go backwards
        const idx = log.entries.map((e) => Number(e.eventId.slice(1)));
        expect(idx.every((v, i) => i === 0 || v >= idx[i - 1]!)).toBe(true);

        // undo appends; prefix is stable
        const originals = log.entries.filter(reversible);
        if (originals.length === 0) return;
        let expectedLen = log.entries.length;
        for (const p of picks) {
          const target = originals[p % originals.length]!;
          const prefix = structuredClone([...log.entries]);
          if (log.isReversed(target.id)) {
            expect(() => log.reverse(target.id, host.inverse, target.at)).toThrow(AlreadyReversedError);
            expect(log.entries).toHaveLength(expectedLen);
            continue;
          }
          const rev = log.reverse(target.id, host.inverse, target.at + 1);
          expectedLen++;
          expect(log.entries).toHaveLength(expectedLen);
          expect(rev).toMatchObject({ status: "reversed", reversalOf: target.id, kind: target.kind, target: target.target });
          expect(log.entries.at(-1)).toBe(rev);
          expect(structuredClone(log.entries.slice(0, prefix.length))).toEqual(prefix);
        }
      }),
      { numRuns: INVARIANT_RUNS },
    );
  });
});
