/** Demo fixtures only. No real services, no real people. */

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
