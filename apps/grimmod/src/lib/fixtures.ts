/**
 * Demo fixtures only. No real services, no real people.
 *
 * FIXTURE CONTRACT (T2.4)
 * - Stable ids: every fixture message has a fixed id (`fx-NNN` for the live demo history, `sim-NNN` for the
 *   simulation history). Ids never depend on the clock or on load order.
 * - Fixed reference clock: `REFERENCE_NOW` (2026-11-11T12:00:00Z). `simulationHistory()` takes no clock;
 *   `fixtureHistory(now)` is shifted by whatever `now` the caller supplies, and `refreshFixtures()` uses REFERENCE_NOW.
 * - Idempotent load/refresh: loading or refreshing fixtures (POST /api/fixtures, `refreshFixtures()`) rebuilds
 *   the same state from scratch, so refreshing twice gives identical message and curse counts and identical
 *   simulation results. Nothing accumulates between refreshes.
 * - The SIMULATION history is separate from the live demo history; the live demo's behaviour is unchanged.
 */

export interface ChatMessage {
  id: string;
  author: string;
  channel: string;
  text: string;
  at: number;
  flagged: boolean;
  /** True when the author was muted at the time the message arrived. */
  muted: boolean;
  /** True for messages posted by a curse (via the post capability). */
  system?: boolean;
}

export const RAID_BOT = "raid-bot";
export const DEFAULT_CHANNEL = "general";

export const EXAMPLE_CURSE =
  "curse spam-strikes: when message where count(message by same author flagged) >= 3 within 7 days -> mute author for 1 day; escalate to owner";

const MINUTE = 60_000;

/**
 * Fixture history, shown on load. Stable IDs. Times are offsets before `now`.
 * This history is display only: the executor sees live events, so the raid-bot
 * starts with a clean slate and is muted on the third flagged live message.
 */
export function fixtureHistory(now: number): ChatMessage[] {
  const m = (n: number, minsAgo: number, author: string, text: string, flagged = false): ChatMessage => ({
    id: `fx-${String(n).padStart(3, "0")}`,
    author,
    channel: DEFAULT_CHANNEL,
    text,
    at: now - minsAgo * MINUTE,
    flagged,
    muted: false,
  });
  return [
    m(1, 42, "mira", "Morning all. Anyone tried the new build?"),
    m(2, 39, "tobias", "Yes, the editor feels much quicker."),
    m(3, 31, "ines", "Reminder: the town hall starts at three."),
    m(4, 24, RAID_BOT, "FREE GIFT CARDS click here http://spam.invalid/a", true),
    m(5, 17, "mira", "Please ignore the bot links, we are looking into it."),
    m(6, 9, "tobias", "Thanks Mira."),
  ];
}

/** Builds `count` flagged raid-bot messages, `gapMs` apart, starting at `start`. */
export function burstMessages(start: number, count = 5, gapMs = 2_000): Omit<ChatMessage, "muted">[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `burst-${start}-${i + 1}`,
    author: RAID_BOT,
    channel: DEFAULT_CHANNEL,
    text: `RAID ${i + 1}/${count}: join now http://spam.invalid/${i + 1}`,
    at: start + i * gapMs,
    flagged: true,
  }));
}

/** Reference clock for fixtures: 2026-11-11T12:00:00Z. */
export const REFERENCE_NOW = Date.UTC(2026, 10, 11, 12, 0, 0);

/** The designed spammers in the simulation history. A muted author outside this set is a false positive. */
export const DESIGNED_SPAMMERS: readonly string[] = [RAID_BOT, "spam-ann", "spam-bo"];

/**
 * Designed simulation history (chat messages, in arrival order, times relative to REFERENCE_NOW).
 * - Three designed spammers each send >= 3 flagged messages within 7 days (spam-bo sends a 4th while muted,
 *   which the simulator suppresses without producing a decision).
 * - Decoys that must NOT be muted: `fluffy` (2 flagged), `slowburn` (3 flagged but spread over 14 days, so never
 *   3 inside one 7-day window), `chatty` (many unflagged), plus ordinary members.
 * - One message arrives late with an earlier timestamp (out of order).
 */
export function simulationHistory(): ChatMessage[] {
  const rows: { minsAgo: number; author: string; text: string; flagged?: boolean }[] = [
    { minsAgo: 20000, author: "slowburn", text: "BUY CHEAP WATCHES http://spam.invalid/w1", flagged: true },
    { minsAgo: 14000, author: "slowburn", text: "BUY CHEAP WATCHES http://spam.invalid/w2", flagged: true },
    { minsAgo: 5000, author: "mira", text: "Morning all." },
    { minsAgo: 4300, author: RAID_BOT, text: "FREE GIFT CARDS http://spam.invalid/a", flagged: true },
    { minsAgo: 4290, author: RAID_BOT, text: "FREE GIFT CARDS http://spam.invalid/b", flagged: true },
    { minsAgo: 4280, author: RAID_BOT, text: "FREE GIFT CARDS http://spam.invalid/c", flagged: true },
    { minsAgo: 4000, author: "chatty", text: "Anyone seen the roadmap?" },
    { minsAgo: 3900, author: "chatty", text: "Also, the new build is fast." },
    { minsAgo: 3800, author: "tobias", text: "Roadmap is pinned." },
    { minsAgo: 3000, author: "spam-ann", text: "WIN A PHONE http://spam.invalid/p1", flagged: true },
    { minsAgo: 2500, author: "chatty", text: "Lunch plans?" },
    { minsAgo: 2400, author: "ines", text: "Town hall at three." },
    { minsAgo: 1500, author: "spam-ann", text: "WIN A PHONE http://spam.invalid/p2", flagged: true },
    { minsAgo: 1400, author: "chatty", text: "Still on for lunch." },
    { minsAgo: 1300, author: "chatty", text: "Great talk today." },
    { minsAgo: 1200, author: "mira", text: "Thanks everyone." },
    { minsAgo: 700, author: "chatty", text: "Evening all." },
    { minsAgo: 600, author: "spam-ann", text: "WIN A PHONE http://spam.invalid/p3", flagged: true },
    { minsAgo: 400, author: "fluffy", text: "CLICK HERE http://spam.invalid/f1", flagged: true },
    { minsAgo: 300, author: "tobias", text: "Please ignore the bot links." },
    { minsAgo: 200, author: "spam-bo", text: "CRYPTO DOUBLER http://spam.invalid/c1", flagged: true },
    { minsAgo: 199, author: "spam-bo", text: "CRYPTO DOUBLER http://spam.invalid/c2", flagged: true },
    { minsAgo: 198, author: "spam-bo", text: "CRYPTO DOUBLER http://spam.invalid/c3", flagged: true },
    { minsAgo: 197, author: "spam-bo", text: "CRYPTO DOUBLER http://spam.invalid/c4", flagged: true },
    { minsAgo: 150, author: "slowburn", text: "BUY CHEAP WATCHES http://spam.invalid/w3", flagged: true },
    { minsAgo: 100, author: "fluffy", text: "CLICK HERE http://spam.invalid/f2", flagged: true },
    { minsAgo: 60, author: "chatty", text: "Back from lunch." },
    // Arrives last but carries an earlier timestamp (out of order).
    { minsAgo: 250, author: "mira", text: "(delayed) Sorry, this posted late." },
  ];
  return rows.map((r, i) => ({
    id: `sim-${String(i + 1).padStart(3, "0")}`,
    author: r.author,
    channel: DEFAULT_CHANNEL,
    text: r.text,
    at: REFERENCE_NOW - r.minsAgo * MINUTE,
    flagged: r.flagged === true,
    muted: false,
  }));
}
