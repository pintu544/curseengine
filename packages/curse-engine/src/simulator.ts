/**
 * Simulator (T2.1). Runs the SAME Executor class over a supplied event history with a RECORDING STUB
 * adapter: every capability only records an intended action. There is no parameter through which a live
 * adapter could be passed, and no second execution path (steering inviolable 2).
 *
 * It mirrors the host rules GrimMod applies to live messages, so a simulation predicts a live run:
 * the clock never moves backwards (`now = max(now, event.at)`), and an event from an author that an earlier
 * (simulated) mute still covers is suppressed: it never reaches the executor and produces no decision.
 */
import type { Curse, Duration } from "./ast.js";
import {
  createExecutor, hasCapability, UndeclaredCapabilityError,
  type Capabilities, type CapabilityName, type DecisionRecord, type EngineEvent, type Executor,
} from "./executor.js";

/** What a capability WOULD have done. Nothing else happens. */
export interface IntendedAction {
  curse: string;
  eventId: string;
  kind: CapabilityName;
  /** Muted author, email recipient, channel or "owner". */
  target: string;
  /** Simulated host clock when the action was issued. */
  at: number;
  durationMs?: number;
  duration?: Duration;
  message?: string;
  template?: string;
}

export interface SuppressedEvent {
  eventId: string;
  author: string;
  at: number;
  /** The curse whose simulated mute covered this event. */
  mutedBy: string;
}

export interface KindCounts { taken: number; skipped: number; failed: number }

export interface SimulationSummary {
  events: number;
  /** Decision records whose conditions matched (outcome executed, partial, failed or skipped-quota). */
  matchedRuns: number;
  suppressed: number;
  byKind: Record<CapabilityName, KindCounts>;
  /** Taken actions grouped by kind and target. */
  perTarget: { kind: CapabilityName; target: string; count: number }[];
  /** Distinct authors muted, in first-muted order. */
  mutedTargets: string[];
}

export interface SimulationReport {
  decisions: DecisionRecord[];
  intended: IntendedAction[];
  suppressed: SuppressedEvent[];
  summary: SimulationSummary;
}

export interface SimulateOptions {
  curses: Curse[];
  /** Events in the order they arrive (timestamps may be out of order; the host clock rule applies). */
  events: EngineEvent[];
  quotaPerHour: number;
  /** Capabilities the modelled host declares. Default: all four. */
  declared?: CapabilityName[];
  /** Event field that names the actor a mute applies to. Default "author". */
  actorField?: string;
}

const KINDS: CapabilityName[] = ["mute", "post", "email", "escalate"];

export async function simulate(opts: SimulateOptions): Promise<SimulationReport> {
  const actorField = opts.actorField ?? "author";
  const declared = new Set<CapabilityName>(opts.declared ?? KINDS);
  const intended: IntendedAction[] = [];
  let clock = Number.NEGATIVE_INFINITY;

  const caps: Capabilities = {};
  if (declared.has("mute")) caps.mute = (r) => { intended.push({ curse: r.curse, eventId: r.eventId, kind: "mute", target: r.target, at: clock, durationMs: r.durationMs, duration: r.duration }); };
  if (declared.has("post")) caps.post = (r) => { intended.push({ curse: r.curse, eventId: r.eventId, kind: "post", target: r.channel, at: clock, message: r.message }); };
  if (declared.has("email")) caps.email = (r) => { intended.push({ curse: r.curse, eventId: r.eventId, kind: "email", target: r.to, at: clock, template: r.template }); };
  if (declared.has("escalate")) caps.escalate = (r) => { intended.push({ curse: r.curse, eventId: r.eventId, kind: "escalate", target: r.to, at: clock }); };

  // Same split the live host makes: curses needing an undeclared capability get their own executor.
  const runnable = opts.curses.filter((c) => c.actions.every((a) => hasCapability(caps, a.kind)));
  const refused = opts.curses.filter((c) => !runnable.includes(c));
  const main: Executor = createExecutor({ curses: runnable, capabilities: caps, quotaPerHour: opts.quotaPerHour });
  const shadows = refused.map((c) => createExecutor({ curses: [c], capabilities: caps, quotaPerHour: opts.quotaPerHour }));

  const mutes: { author: string; until: number; curse: string }[] = [];
  const decisions: DecisionRecord[] = [];
  const suppressed: SuppressedEvent[] = [];

  const run = async (ex: Executor, ev: EngineEvent): Promise<void> => {
    try { decisions.push(...(await ex.handle(ev))); } catch (err) {
      if (!(err instanceof UndeclaredCapabilityError)) throw err;
      decisions.push(err.record);
    }
  };

  for (const original of opts.events) {
    clock = Math.max(clock, original.at);
    const ev: EngineEvent = { ...original, at: clock, fields: { ...original.fields } };
    const actor = ev.fields[actorField];
    const cover = actor === undefined ? undefined : mutes.find((m) => m.author === String(actor) && clock < m.until);
    if (cover) { suppressed.push({ eventId: ev.id, author: String(actor), at: clock, mutedBy: cover.curse }); continue; }
    const before = intended.length;
    await run(main, ev);
    for (const s of shadows) await run(s, ev);
    for (const a of intended.slice(before)) {
      if (a.kind === "mute") mutes.push({ author: a.target, until: a.at + (a.durationMs ?? 0), curse: a.curse });
    }
  }
  return { decisions, intended, suppressed, summary: summarise(opts.events.length, decisions, suppressed.length) };
}

function summarise(events: number, decisions: DecisionRecord[], suppressed: number): SimulationSummary {
  const byKind = Object.fromEntries(KINDS.map((k) => [k, { taken: 0, skipped: 0, failed: 0 }])) as Record<CapabilityName, KindCounts>;
  const per = new Map<string, { kind: CapabilityName; target: string; count: number }>();
  const muted: string[] = [];
  let matchedRuns = 0;
  for (const d of decisions) {
    if (d.matched) matchedRuns++;
    // Only runs that matched count their actions: a "no-match" record lists its actions as skipped for display.
    if (!d.matched) continue;
    for (const a of d.actions) {
      byKind[a.kind][a.status]++;
      if (a.status !== "taken" || a.target === null) continue;
      const key = `${a.kind}\u0000${a.target}`;
      const row = per.get(key) ?? { kind: a.kind, target: a.target, count: 0 };
      row.count++;
      per.set(key, row);
      if (a.kind === "mute" && !muted.includes(a.target)) muted.push(a.target);
    }
  }
  return { events, matchedRuns, suppressed, byKind, perTarget: [...per.values()], mutedTargets: muted };
}

/**
 * One-line summary. With an expected set of muted targets (the designed offenders) it reports
 * "N muted, M false positives" (a false positive is a muted target outside the set). Without one it reports counts only.
 */
export function summaryLine(report: SimulationReport, expectedMuted?: Iterable<string>): string {
  const s = report.summary;
  const muted = s.mutedTargets.length;
  if (expectedMuted) {
    const ok = new Set(expectedMuted);
    const fp = s.mutedTargets.filter((t) => !ok.has(t)).length;
    return `${muted} muted, ${fp} false positive${fp === 1 ? "" : "s"}`;
  }
  return `${muted} muted, ${s.byKind.escalate.taken} escalated, ${s.byKind.post.taken} posted, ${s.byKind.email.taken} emailed`;
}
