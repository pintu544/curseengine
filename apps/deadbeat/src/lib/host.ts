import { createExecutor, hasCapability, parseCurse, UndeclaredCapabilityError, type AuditEntry, type Capabilities, type Curse, type DecisionRecord, type EngineEvent, type Executor } from "@curseengine/engine";
import { createMailAdapter } from "./adapter";
import { DAY_MS, fixtureInvoices, REFERENCE_NOW, TIER_CURSES, type Invoice } from "./fixtures";
import { createGrimoire, mailInverse, type GrimoireRepository } from "./grimoire";
import { InvoiceState, type InvoiceSnapshot } from "./invoice-state";

/** Demo quota: curse runs allowed per curse per rolling hour. Far above what a tick round reaches. */
export const DEMO_QUOTA_PER_HOUR = 1000;

/** Name of the FR9 kill switch environment variable. `0`, `false` or `off` (any case) disables the engine. */
export const ENGINE_ENABLED_ENV = "CURSE_ENGINE_ENABLED";

/** Reads the kill switch from the environment: on unless explicitly set to 0, false or off. */
export function engineEnabledFromEnv(env: Record<string, string | undefined> = process.env): boolean {
  const v = env[ENGINE_ENABLED_ENV]?.trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "off");
}

/** Thrown by tick intake while the FR9 kill switch is off. Nothing has been advanced, recorded or executed. */
export class EngineDisabledError extends Error {
  constructor() {
    super(`The curse engine is disabled (kill switch: ${ENGINE_ENABLED_ENV}=off). No tick was processed and no email, escalation or grimoire entry was produced.`);
    this.name = "EngineDisabledError";
  }
}

/** Upper bound for one advance request, so a single call stays small. */
export const MAX_ADVANCE_DAYS = 90;

export interface TickResult extends InvoiceSnapshot {
  days: number;
  decisions: DecisionRecord[];
}

/** Converts an invoice to the `tick` engine event the executor (and the simulator) sees. */
export function toTickEvent(invoice: Invoice, id: string, at: number): EngineEvent {
  return {
    id,
    type: "tick",
    at,
    interval: { amount: 1, unit: "day" },
    fields: {
      invoice_id: invoice.id,
      days_overdue: invoice.daysOverdue,
      client: invoice.clientEmail,
      client_name: invoice.clientName,
      amount: invoice.amount,
    },
  };
}

/**
 * The app side of the engine: holds curses, advances the clock, emits one tick per invoice per day and
 * applies actions to invoice state.
 *
 * Sent-tier tracking: the executor dedupes nothing, so before each invoice's tick the host hands the executor
 * only the curses that have not yet acted on that invoice. A curse counts as having acted when its decision
 * took at least one action. A second tick on the same day therefore sends nothing, records no taken action
 * and adds no grimoire entry. Undoing an email does not allow a re-send within the same tier.
 */
export class DeadbeatHost {
  readonly state: InvoiceState;
  /** Every installed curse, in install order. */
  private curses: Curse[] = [];
  private readonly capabilities: Capabilities;
  /** Installed curses the adapter can run (full set). */
  private readonly usable: Curse[] = [];
  /** What the executor sees: `usable` minus the curses already sent for the current invoice. Edited in place per tick. */
  private readonly active: Curse[] = [];
  private readonly executor: Executor;
  /** Curses using an undeclared capability each get their own executor so their refusal stops nobody else. */
  private readonly refused = new Map<string, Executor>();
  readonly decisions: DecisionRecord[] = [];
  readonly grimoire: GrimoireRepository = createGrimoire();
  private pendingRefs: string[] = [];
  private tickSeq = 0;
  /** FR9 kill switch override. Unset means "follow the environment variable", read on every call. */
  private engineOverride: boolean | undefined;

  constructor(now: number = REFERENCE_NOW, private readonly quotaPerHour: number = DEMO_QUOTA_PER_HOUR) {
    this.state = new InvoiceState(fixtureInvoices(), now);
    this.capabilities = createMailAdapter(this.state, (ref) => this.pendingRefs.push(ref));
    this.executor = createExecutor({ curses: this.active, capabilities: this.capabilities, quotaPerHour });
  }

  /** Installs (or replaces, by name) a curse. The executor is kept, so quota state survives. */
  install(curse: Curse): void {
    const at = this.curses.findIndex((c) => c.name === curse.name);
    if (at >= 0) this.curses.splice(at, 1);
    this.curses.push(curse);
    const old = this.usable.findIndex((c) => c.name === curse.name);
    if (old >= 0) this.usable.splice(old, 1);
    this.refused.delete(curse.name);
    if (curse.actions.every((a) => hasCapability(this.capabilities, a.kind))) this.usable.push(curse);
    else this.refused.set(curse.name, createExecutor({ curses: [curse], capabilities: this.capabilities, quotaPerHour: this.quotaPerHour }));
  }

  /** True while the engine may process ticks (FR9 kill switch). */
  get engineEnabled(): boolean {
    return this.engineOverride ?? engineEnabledFromEnv();
  }

  /** Turns the engine on or off for this host (overrides the environment variable); `undefined` returns to the environment. */
  setEngineEnabled(enabled: boolean | undefined): void {
    this.engineOverride = enabled;
  }

  getCurses(): Curse[] {
    return [...this.curses];
  }

  /**
   * Advances the clock by `days` whole days (forward only). Each day increments every invoice's days_overdue and
   * emits one tick per invoice. `days` of 0 re-emits one round of ticks at the current clock (nothing already
   * sent is sent again).
   */
  async advanceClock(days = 1): Promise<TickResult> {
    if (!Number.isInteger(days) || days < 0 || days > MAX_ADVANCE_DAYS) throw new RangeError(`days must be a whole number from 0 to ${MAX_ADVANCE_DAYS}.`);
    // FR9 kill switch: refuse before the clock or any invoice moves.
    if (!this.engineEnabled) throw new EngineDisabledError();
    const decisions: DecisionRecord[] = [];
    const rounds = Math.max(days, 1);
    for (let d = 0; d < rounds; d++) {
      if (days > 0) {
        this.state.clock += DAY_MS;
        for (const inv of this.state.invoices) inv.daysOverdue += 1;
      }
      for (const inv of this.state.invoices) {
        this.tickSeq += 1;
        decisions.push(...(await this.intake(toTickEvent(inv, `tick-${String(this.tickSeq).padStart(6, "0")}-${inv.id}`, this.state.clock), inv)));
      }
    }
    return { ...this.state.snapshot(), days, decisions };
  }

  /**
   * Single choke point for every event that reaches the executor. The FR9 kill switch is enforced here as well as in advanceClock.
   * Runs the curses not yet sent for this invoice, records decisions, marks tiers sent and writes the grimoire.
   */
  private async intake(event: EngineEvent, invoice: Invoice): Promise<DecisionRecord[]> {
    if (!this.engineEnabled) throw new EngineDisabledError();
    this.state.currentInvoiceId = invoice.id;
    const due = (c: Curse) => !this.state.hasSent(invoice.id, c.name);
    this.active.splice(0, this.active.length, ...this.usable.filter(due));
    this.pendingRefs = [];
    const decisions: DecisionRecord[] = [];
    const run = async (ex: Executor): Promise<void> => {
      try {
        decisions.push(...(await ex.handle(event)));
      } catch (err) {
        if (!(err instanceof UndeclaredCapabilityError)) throw err;
        decisions.push(err.record);
      }
    };
    await run(this.executor);
    for (const [name, shadow] of this.refused) if (!this.state.hasSent(invoice.id, name)) await run(shadow);
    this.decisions.push(...decisions);
    const summary = `invoice ${invoice.id} (${invoice.clientName}), ${invoice.daysOverdue} days overdue`;
    let k = 0;
    for (const rec of decisions) {
      const n = rec.actions.filter((a) => a.status === "taken").length;
      if (n > 0) this.state.markSent(invoice.id, rec.curse);
      this.grimoire.recordDecision(rec, summary, this.pendingRefs.slice(k, k + n));
      k += n;
    }
    this.pendingRefs = [];
    return decisions;
  }

  /** One-click undo: runs the inverse, then appends a reversal entry referencing the original. */
  undo(entryId: string): AuditEntry {
    return this.grimoire.reverse(entryId, mailInverse(this.state), this.state.clock);
  }
}

const KEY = "__deadbeatHost";
type G = typeof globalThis & { [KEY]?: DeadbeatHost; __deadbeatGraphs?: Map<string, Curse> };

/** Process-wide singleton, safe across dev hot reloads. */
export function getHost(): DeadbeatHost {
  const g = globalThis as G;
  return (g[KEY] ??= new DeadbeatHost());
}

/** Demo reset: a new host at the reference clock with the fixture invoices and NO curses installed. */
export function resetHost(now: number = REFERENCE_NOW): DeadbeatHost {
  const g = globalThis as G;
  g[KEY] = new DeadbeatHost(now);
  g.__deadbeatGraphs = new Map();
  return g[KEY];
}

/** Loads (or refreshes) the fixture set: a reset host with the three tier curses installed. Idempotent. */
export function refreshFixtures(): DeadbeatHost {
  const host = resetHost(REFERENCE_NOW);
  for (const src of TIER_CURSES) {
    const curse = parseCurse(src);
    curseStore().set(curse.name, curse);
    host.install(curse);
  }
  return host;
}

/** Curse store keyed by curse name (graph lookups). */
export function curseStore(): Map<string, Curse> {
  const g = globalThis as G;
  return (g.__deadbeatGraphs ??= new Map());
}
