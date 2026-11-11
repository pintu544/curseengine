import { createExecutor, type Curse, type DecisionRecord, type EngineEvent, type Executor } from "@curseengine/engine";
import { createChatAdapter } from "./adapter";
import { ChatState, type ChatSnapshot } from "./chat-state";
import { fixtureHistory, type ChatMessage } from "./fixtures";

/**
 * Demo quota: curse runs allowed per curse per rolling hour. Set well above anything a
 * burst can reach (a burst is 5 messages) so the quota never hides the storyline.
 */
export const DEMO_QUOTA_PER_HOUR = 1000;

export type IncomingMessage = Omit<ChatMessage, "muted" | "system">;

export interface HostResult {
  message: ChatMessage;
  decisions: DecisionRecord[];
  chat: ChatSnapshot;
}

/** The app side of the engine: holds curses, feeds chat messages as events, applies actions to chat state. */
export class GrimModHost {
  readonly chat: ChatState;
  private curses: Curse[] = [];
  private executor: Executor;
  /** Every decision record since the host started, in order. */
  readonly decisions: DecisionRecord[] = [];

  constructor(now: number = Date.now(), private readonly quotaPerHour: number = DEMO_QUOTA_PER_HOUR) {
    this.chat = new ChatState(fixtureHistory(now));
    this.executor = this.build();
  }

  private build(): Executor {
    return createExecutor({ curses: this.curses, capabilities: createChatAdapter(this.chat), quotaPerHour: this.quotaPerHour });
  }

  /** Installs (or replaces, by name) a curse. Rebuilds the executor, so live history restarts for counting. */
  install(curse: Curse): void {
    this.curses = [...this.curses.filter((c) => c.name !== curse.name), curse];
    this.executor = this.build();
  }

  getCurses(): Curse[] {
    return [...this.curses];
  }

  /** Records the message in chat, converts it to an EngineEvent and runs the executor. */
  async receive(msg: IncomingMessage): Promise<HostResult> {
    this.chat.now = msg.at;
    const stored = this.chat.addMessage(msg);
    // A muted author's message is suppressed: shown as muted, never fed to the executor.
    if (stored.muted) return { message: { ...stored }, decisions: [], chat: this.chat.snapshot() };
    const event: EngineEvent = {
      id: stored.id,
      type: "message",
      at: stored.at,
      flagged: stored.flagged,
      fields: { author: stored.author, channel: stored.channel, text: stored.text, flagged: stored.flagged },
    };
    const decisions = await this.executor.handle(event);
    this.decisions.push(...decisions);
    return { message: { ...stored }, decisions, chat: this.chat.snapshot() };
  }
}

const KEY = "__grimmodHost";
type G = typeof globalThis & { [KEY]?: GrimModHost; __grimmodGraphs?: Map<string, Curse> };

/** Process-wide singleton, safe across dev hot reloads. */
export function getHost(): GrimModHost {
  const g = globalThis as G;
  return (g[KEY] ??= new GrimModHost());
}

export function resetHost(now?: number): GrimModHost {
  const g = globalThis as G;
  g[KEY] = new GrimModHost(now);
  g.__grimmodGraphs = new Map();
  return g[KEY];
}

/** Curse store keyed by generated id (graph lookups). */
export function curseStore(): Map<string, Curse> {
  const g = globalThis as G;
  return (g.__grimmodGraphs ??= new Map());
}
