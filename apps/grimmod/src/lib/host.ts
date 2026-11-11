import { createExecutor, UndeclaredCapabilityError, type Capabilities, type Curse, type DecisionRecord, type EngineEvent, type Executor } from "@curseengine/engine";
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
  /** Every installed curse, in install order. */
  private curses: Curse[] = [];
  private readonly capabilities: Capabilities;
  /**
   * Curses the adapter can run. This array is handed to the executor by reference and edited
   * in place on install, so the executor keeps its count history and quota state across installs.
   */
  private readonly runnable: Curse[] = [];
  private readonly executor: Executor;
  /**
   * Curses that use a capability the adapter does not declare (for example `email`). Each gets
   * its own executor so its refusal cannot stop other curses from running on the same event.
   * A shadow executor only sees events from the moment the curse was installed.
   */
  private readonly refused = new Map<string, Executor>();
  /** Every decision record since the host started, in order. */
  readonly decisions: DecisionRecord[] = [];

  constructor(now: number = Date.now(), private readonly quotaPerHour: number = DEMO_QUOTA_PER_HOUR) {
    this.chat = new ChatState(fixtureHistory(now));
    this.capabilities = createChatAdapter(this.chat);
    this.executor = createExecutor({ curses: this.runnable, capabilities: this.capabilities, quotaPerHour });
  }

  /**
   * Installs (or replaces, by name) a curse. The executor is kept, so count history and
   * quota state survive. Replacing a curse keeps its quota usage, which is keyed by name.
   */
  install(curse: Curse): void {
    const at = this.curses.findIndex((c) => c.name === curse.name);
    if (at >= 0) this.curses.splice(at, 1);
    this.curses.push(curse);
    const old = this.runnable.findIndex((c) => c.name === curse.name);
    if (old >= 0) this.runnable.splice(old, 1);
    this.refused.delete(curse.name);
    const usable = curse.actions.every((a) => typeof this.capabilities[a.kind] === "function");
    if (usable) this.runnable.push(curse);
    else this.refused.set(curse.name, createExecutor({ curses: [curse], capabilities: this.capabilities, quotaPerHour: this.quotaPerHour }));
  }

  getCurses(): Curse[] {
    return [...this.curses];
  }

  /**
   * Records the message in chat, converts it to an EngineEvent and runs the executor.
   * A curse whose action fails produces a failed decision record; it never throws and never
   * stops other curses from running.
   */
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
    const decisions: DecisionRecord[] = [];
    try {
      decisions.push(...(await this.executor.handle(event)));
    } catch (err) {
      if (!(err instanceof UndeclaredCapabilityError)) throw err;
      decisions.push(err.record);
    }
    for (const shadow of this.refused.values()) {
      try {
        decisions.push(...(await shadow.handle(event)));
      } catch (err) {
        if (!(err instanceof UndeclaredCapabilityError)) throw err;
        decisions.push(err.record);
      }
    }
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
