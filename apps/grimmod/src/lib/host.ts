import { engineEnabledFromEnv, EngineDisabledError } from "@curseengine/kill-switch";
import { createExecutor, hasCapability, parseCurse, type AuditEntry, UndeclaredCapabilityError, type Capabilities, type CapabilityName, type Curse, type DecisionRecord, type EngineEvent, type Executor } from "@curseengine/engine";
import { createChatAdapter } from "./adapter";
import { ChatState, type ChatSnapshot } from "./chat-state";
import { EXAMPLE_CURSE, fixtureHistory, REFERENCE_NOW, type ChatMessage } from "./fixtures";
import { chatInverse, createGrimoire, replayEntries, type GrimoireRepository } from "./grimoire";
import type { Escalation, MuteEntry } from "./chat-state";

export { ENGINE_ENABLED_ENV, engineEnabledFromEnv, EngineDisabledError } from "@curseengine/kill-switch";

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

/** Most decision records kept in a persisted snapshot (the newest). The grimoire itself is never truncated. */
export const MAX_PERSISTED_DECISIONS = 500;

/** JSON-safe host state written to Postgres. The grimoire is stored separately (append-only). */
export interface GrimmodSnapshot {
  v: 1;
  chat: { messages: ChatMessage[]; mutes: MuteEntry[]; escalations: Escalation[]; now: number };
  curses: Curse[];
  decisions: DecisionRecord[];
  suppressed: SuppressedMessage[];
  /** Kill-switch override: null means "follow the environment". */
  engineOverride: boolean | null;
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
  /** Audit log (grimoire): one entry per executed action, append-only. */
  readonly grimoire: GrimoireRepository = createGrimoire();
  /** Messages that arrived while their author was muted: no decision, no grimoire entry. */
  readonly suppressed: SuppressedMessage[] = [];
  private pendingRefs: string[] = [];
  /**
   * FR9 kill switch. When false, receive() refuses before touching chat state, the executor or the grimoire.
   * Unset means "follow the environment variable", read on every call so it can be flipped without a restart.
   */
  private engineOverride: boolean | undefined;

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

  /** True while the engine may process events (FR9 kill switch). */
  get engineEnabled(): boolean {
    return this.engineOverride ?? engineEnabledFromEnv();
  }

  /** Turns the engine on or off for this host (overrides the environment variable); `undefined` returns to the environment. */
  setEngineEnabled(enabled: boolean | undefined): void {
    this.engineOverride = enabled;
  }

  /** The programmatic kill switch override (`undefined` follows the environment). Carried across demo resets. */
  get engineOverrideValue(): boolean | undefined {
    return this.engineOverride;
  }

  /** Capabilities the adapter declares, derived from the adapter itself (used for dry runs). */
  declaredCapabilities(): CapabilityName[] {
    return (Object.keys(this.capabilities) as CapabilityName[]).filter((k) => hasCapability(this.capabilities, k));
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
    // FR9 kill switch: the single intake choke point. Off means no chat change, no decision, no grimoire entry.
    if (!this.engineEnabled) throw new EngineDisabledError();
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

  /** State to persist (everything except the grimoire). Deep-copied through JSON so later edits cannot leak in. */
  snapshotState(): GrimmodSnapshot {
    const snap: GrimmodSnapshot = {
      v: 1,
      chat: { ...this.chat.snapshot(), now: this.chat.now },
      curses: this.curses,
      decisions: this.decisions.slice(-MAX_PERSISTED_DECISIONS),
      suppressed: this.suppressed,
      engineOverride: this.engineOverride ?? null,
    };
    return JSON.parse(JSON.stringify(snap)) as GrimmodSnapshot;
  }

  /** Restores persisted state into a fresh host. Executor count history and quota usage are not persisted. */
  restoreState(snap: GrimmodSnapshot, entries: readonly AuditEntry[]): void {
    this.chat.messages = snap.chat.messages;
    this.chat.mutes = snap.chat.mutes;
    this.chat.escalations = snap.chat.escalations;
    this.chat.now = snap.chat.now;
    for (const c of snap.curses) this.install(c);
    this.decisions.push(...snap.decisions);
    this.suppressed.push(...snap.suppressed);
    this.engineOverride = snap.engineOverride ?? undefined;
    replayEntries(this.grimoire, entries);
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
  const override = g[KEY]?.engineOverrideValue;
  g[KEY] = new GrimModHost(now);
  // The kill switch is an operator control, so a demo reset must not silently switch the engine back on.
  g[KEY].setEngineEnabled(override);
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
