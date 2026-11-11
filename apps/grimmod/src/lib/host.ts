import { createExecutor, hasCapability, parseCurse, type AuditEntry, UndeclaredCapabilityError, type Capabilities, type Curse, type DecisionRecord, type EngineEvent, type Executor } from "@curseengine/engine";
import { createChatAdapter } from "./adapter";
import { ChatState, type ChatSnapshot } from "./chat-state";
import { EXAMPLE_CURSE, fixtureHistory, REFERENCE_NOW, type ChatMessage } from "./fixtures";
import { chatInverse, createGrimoire, type GrimoireRepository } from "./grimoire";

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

/** Converts a chat message to the engine event the executor (and the simulator) sees. */
export function toEngineEvent(m: Pick<ChatMessage, "id" | "author" | "channel" | "text" | "at" | "flagged">): EngineEvent {
  return { id: m.id, type: "message", at: m.at, flagged: m.flagged, fields: { author: m.author, channel: m.channel, text: m.text, flagged: m.flagged } };
}

export interface SuppressedMessage { eventId: string; author: string; at: number }

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
  /** Audit log (grimoire): one entry per executed action, append-only. */
  readonly grimoire: GrimoireRepository = createGrimoire();
  /** Messages that arrived while their author was muted: no decision, no grimoire entry. */
  readonly suppressed: SuppressedMessage[] = [];
  private pendingRefs: string[] = [];

  constructor(now: number = Date.now(), private readonly quotaPerHour: number = DEMO_QUOTA_PER_HOUR) {
    this.chat = new ChatState(fixtureHistory(now));
    this.capabilities = createChatAdapter(this.chat, (ref) => this.pendingRefs.push(ref));
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
    const usable = curse.actions.every((a) => hasCapability(this.capabilities, a.kind));
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
    // The host clock never moves backwards: a backdated message is treated as arriving "now",
    // so mute windows and count windows anchor to one monotonic clock.
    this.chat.now = Math.max(this.chat.now, msg.at);
    const stored = this.chat.addMessage({ ...msg, at: this.chat.now });
    // A muted author's message is suppressed: shown as muted, never fed to the executor.
    if (stored.muted) {
      this.suppressed.push({ eventId: stored.id, author: stored.author, at: stored.at });
      return { message: { ...stored }, decisions: [], chat: this.chat.snapshot() };
    }
    const event = toEngineEvent(stored);
    this.pendingRefs = [];
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
    // Every taken action gets exactly one grimoire entry, in order. Refs align with taken actions.
    const summary = `message from ${stored.author}: "${stored.text.length > 80 ? `${stored.text.slice(0, 80)}...` : stored.text}"`;
    let k = 0;
    for (const rec of decisions) {
      const n = rec.actions.filter((a) => a.status === "taken").length;
      this.grimoire.recordDecision(rec, summary, this.pendingRefs.slice(k, k + n));
      k += n;
    }
    this.pendingRefs = [];
    return { message: { ...stored }, decisions, chat: this.chat.snapshot() };
  }

  /** One-click undo: runs the inverse, then appends a reversal entry referencing the original. */
  undo(entryId: string): AuditEntry {
    return this.grimoire.reverse(entryId, chatInverse(this.chat), this.chat.now);
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

/**
 * Loads (or refreshes) the fixture set: the host is rebuilt from scratch at REFERENCE_NOW and the example
 * curse installed. Idempotent: calling it twice yields identical state.
 */
export function refreshFixtures(): GrimModHost {
  const host = resetHost(REFERENCE_NOW);
  const curse = parseCurse(EXAMPLE_CURSE);
  curseStore().set(curse.name, curse);
  host.install(curse);
  return host;
}

/** Curse store keyed by generated id (graph lookups). */
export function curseStore(): Map<string, Curse> {
  const g = globalThis as G;
  return (g.__grimmodGraphs ??= new Map());
}
