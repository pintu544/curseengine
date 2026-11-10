/**
 * Sandboxed executor (T1.4). Pure logic: no I/O imports, no eval/Function.
 * Actions run ONLY through the capability interface supplied by the host.
 */
import type { Action, CompareCondition, Condition, Conditions, CountCondition, Curse, Duration, TextCondition } from "./ast.js";

/** An incoming event. `fields` is the flat field bag conditions/targets read from. */
export interface EngineEvent {
  id: string;
  /** e.g. "message", "webhook", or "tick" (timer tick supplied by the host). */
  type: string;
  /** Epoch milliseconds. */
  at: number;
  fields: Record<string, string | number | boolean>;
  /** Whether this event is flagged (used by `count(... flagged)`). */
  flagged?: boolean;
  /** For type "tick": which `every` interval fired. */
  interval?: Duration;
}

/** Capability interface the host app supplies. Anything not provided is undeclared. */
export interface Capabilities {
  mute?(req: { curse: string; eventId: string; target: string; durationMs: number; duration: Duration }): void | Promise<void>;
  post?(req: { curse: string; eventId: string; message: string; channel: string }): void | Promise<void>;
  email?(req: { curse: string; eventId: string; template: string; to: string }): void | Promise<void>;
  escalate?(req: { curse: string; eventId: string; to: "owner" }): void | Promise<void>;
}
export type CapabilityName = keyof Capabilities;

export interface ExecutorOptions {
  curses: Curse[];
  capabilities: Capabilities;
  /** Max executions (matched runs) per curse per rolling hour. */
  quotaPerHour: number;
}

export interface ConditionRecord {
  kind: Condition["kind"];
  description: string;
  /** What was observed (count, field value). undefined when the field was absent. */
  observed: string | number | boolean | undefined;
  /** What it was compared against. */
  expected: string | number;
  result: boolean;
  note?: string;
}

export interface ActionRecord {
  kind: Action["kind"];
  target: string;
  status: "taken" | "skipped" | "failed";
  reason: string;
}

export interface DecisionRecord {
  curse: string;
  eventId: string;
  eventType: string;
  at: number;
  conditions: ConditionRecord[];
  matched: boolean;
  outcome: "no-match" | "executed" | "skipped-quota" | "failed";
  quota: { used: number; limit: number };
  actions: ActionRecord[];
}

export class UndeclaredCapabilityError extends Error {
  constructor(public readonly curse: string, public readonly capability: CapabilityName, public readonly record: DecisionRecord) {
    super(`Curse "${curse}" invokes capability "${capability}" which the host did not declare; execution refused`);
    this.name = "UndeclaredCapabilityError";
  }
}

const UNIT_MS = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 } as const;
export const durationMs = (d: Duration): number => d.amount * UNIT_MS[d.unit];
const HOUR = UNIT_MS.hour;

const dur = (d: Duration) => `${d.amount} ${d.unit}${d.amount === 1 ? "" : "s"}`;

export class Executor {
  private history: EngineEvent[] = [];
  private runs = new Map<string, number[]>();
  /** Every decision record produced, in order. */
  readonly records: DecisionRecord[] = [];

  constructor(private readonly opts: ExecutorOptions) {}

  /** Process one event against all curses whose trigger matches. Throws UndeclaredCapabilityError on sandbox violation. */
  async handle(event: EngineEvent): Promise<DecisionRecord[]> {
    if (event.type !== "tick") this.history.push(event);
    const out: DecisionRecord[] = [];
    for (const curse of this.opts.curses) {
      const where = this.triggerMatch(curse, event);
      if (where === false) continue;
      const rec = await this.evaluate(curse, event, where === true ? undefined : where);
      this.records.push(rec);
      out.push(rec);
      if (rec.outcome === "failed" && rec.actions.some((a) => a.reason.startsWith("undeclared capability"))) {
        const cap = rec.actions.find((a) => a.reason.startsWith("undeclared capability"))!.kind as CapabilityName;
        throw new UndeclaredCapabilityError(curse.name, cap, rec);
      }
    }
    return out;
  }

  /** false = trigger does not match; true = matches, no where; Conditions = matches, evaluate these. */
  private triggerMatch(curse: Curse, e: EngineEvent): boolean | Conditions {
    const t = curse.trigger;
    switch (t.kind) {
      case "event":
        return e.type === t.event ? (t.where ?? true) : false;
      case "timer":
        return e.type === "tick" && e.interval !== undefined && durationMs(e.interval) === durationMs(t.interval) ? (t.where ?? true) : false;
      case "webhook":
        return e.type === "webhook" && e.fields["path"] === t.path;
    }
  }

  private async evaluate(curse: Curse, e: EngineEvent, where: Conditions | undefined): Promise<DecisionRecord> {
    const conditions: ConditionRecord[] = [];
    let matched = true;
    if (where) {
      // Flat, left-to-right in source order; no operator precedence. All conditions are evaluated so the record is complete.
      const first = this.cond(where.first, e);
      conditions.push(first);
      let acc = first.result;
      for (const r of where.rest) {
        const c = this.cond(r.condition, e);
        conditions.push(c);
        acc = r.connector === "and" ? acc && c.result : acc || c.result;
      }
      matched = acc;
    }
    const limit = this.opts.quotaPerHour;
    const recent = (this.runs.get(curse.name) ?? []).filter((t) => t > e.at - HOUR && t <= e.at);
    const base = { curse: curse.name, eventId: e.id, eventType: e.type, at: e.at, conditions, matched };
    if (!matched) {
      return { ...base, outcome: "no-match", quota: { used: recent.length, limit }, actions: curse.actions.map((a) => this.rec(a, "skipped", "conditions not matched")) };
    }
    if (recent.length >= limit) {
      return { ...base, outcome: "skipped-quota", quota: { used: recent.length, limit }, actions: curse.actions.map((a) => this.rec(a, "skipped", `hourly quota exceeded (${recent.length}/${limit})`)) };
    }
    // Sandbox preflight: refuse the whole run before any action executes.
    const missing = curse.actions.find((a) => typeof this.opts.capabilities[a.kind] !== "function");
    if (missing) {
      return {
        ...base, outcome: "failed", quota: { used: recent.length, limit },
        actions: curse.actions.map((a) => this.rec(a, a === missing ? "failed" : "skipped", a === missing ? `undeclared capability "${a.kind}"` : "run refused: sandbox violation"))
          .map((r) => (r.status === "failed" ? r : { ...r })),
      };
    }
    recent.push(e.at);
    this.runs.set(curse.name, recent);
    const actions: ActionRecord[] = [];
    let failed = false;
    for (const a of curse.actions) {
      try {
        actions.push(await this.run(curse, a, e));
      } catch (err) {
        failed = true;
        actions.push(this.rec(a, "failed", `capability threw: ${err instanceof Error ? err.message : String(err)}`));
      }
    }
    return { ...base, outcome: failed ? "failed" : "executed", quota: { used: recent.length, limit }, actions };
  }

  private rec(a: Action, status: ActionRecord["status"], reason: string): ActionRecord {
    const target = a.kind === "mute" ? a.target : a.kind === "post" ? a.channel : a.kind === "email" ? a.to : a.to;
    return { kind: a.kind, target, status, reason };
  }

  private async run(curse: Curse, a: Action, e: EngineEvent): Promise<ActionRecord> {
    const caps = this.opts.capabilities;
    const base = { curse: curse.name, eventId: e.id };
    switch (a.kind) {
      case "mute": {
        const who = e.fields[a.target];
        if (who === undefined) return { kind: "mute", target: a.target, status: "skipped", reason: `event has no field "${a.target}"` };
        await caps.mute!({ ...base, target: String(who), durationMs: durationMs(a.duration), duration: a.duration });
        return { kind: "mute", target: String(who), status: "taken", reason: `muted for ${dur(a.duration)}` };
      }
      case "post":
        await caps.post!({ ...base, message: a.message, channel: a.channel });
        return { kind: "post", target: a.channel, status: "taken", reason: "posted" };
      case "email": {
        const to = e.fields[a.to];
        if (to === undefined) return { kind: "email", target: a.to, status: "skipped", reason: `event has no field "${a.to}"` };
        await caps.email!({ ...base, template: a.template, to: String(to) });
        return { kind: "email", target: String(to), status: "taken", reason: `sent template ${a.template}` };
      }
      case "escalate":
        await caps.escalate!({ ...base, to: "owner" });
        return { kind: "escalate", target: "owner", status: "taken", reason: "escalated" };
    }
  }

  private cond(c: Condition, e: EngineEvent): ConditionRecord {
    return c.kind === "count" ? this.count(c, e) : c.kind === "compare" ? this.compare(c, e) : this.text(c, e);
  }

  private count(c: CountCondition, e: EngineEvent): ConditionRecord {
    const from = e.at - durationMs(c.window);
    let group: string | number | boolean | undefined;
    if (c.bySameField) group = e.fields[c.bySameField];
    const n = this.history.filter(
      (h) => h.type === c.event && h.at > from && h.at <= e.at &&
        (!c.flagged || h.flagged === true) &&
        (!c.bySameField || (group !== undefined && h.fields[c.bySameField] === group)),
    ).length;
    const desc = `count(${c.event}${c.bySameField ? ` by same ${c.bySameField}${group !== undefined ? `=${group}` : ""}` : ""}${c.flagged ? " flagged" : ""}) >= ${c.threshold} within ${dur(c.window)}`;
    const note = c.bySameField && group === undefined ? `event has no field "${c.bySameField}"` : undefined;
    return { kind: "count", description: desc, observed: n, expected: c.threshold, result: n >= c.threshold, ...(note ? { note } : {}) };
  }

  private compare(c: CompareCondition, e: EngineEvent): ConditionRecord {
    const v = e.fields[c.field];
    const expected = c.value.value;
    const description = `${c.field} ${c.op} ${expected}`;
    if (v === undefined) return { kind: "compare", description, observed: undefined, expected, result: false, note: `event has no field "${c.field}"` };
    let result: boolean;
    let note: string | undefined;
    if (c.op === "=") {
      result = typeof v === "number" && c.value.type === "number" ? v === expected : String(v) === String(expected);
    } else if (typeof v === "number" && typeof expected === "number") {
      result = c.op === ">" ? v > expected : c.op === ">=" ? v >= expected : c.op === "<" ? v < expected : v <= expected;
    } else {
      result = false;
      note = "ordering comparison requires numeric operands";
    }
    return { kind: "compare", description, observed: v, expected, result, ...(note ? { note } : {}) };
  }

  private text(c: TextCondition, e: EngineEvent): ConditionRecord {
    const v = e.fields[c.field];
    const description = `${c.field} ${c.op} "${c.pattern}"`;
    if (v === undefined) return { kind: "text", description, observed: undefined, expected: c.pattern, result: false, note: `event has no field "${c.field}"` };
    const s = String(v);
    if (c.op === "contains") return { kind: "text", description, observed: s, expected: c.pattern, result: s.includes(c.pattern) };
    try {
      return { kind: "text", description, observed: s, expected: c.pattern, result: new RegExp(c.pattern).test(s) };
    } catch {
      return { kind: "text", description, observed: s, expected: c.pattern, result: false, note: "invalid regular expression" };
    }
  }
}

export function createExecutor(opts: ExecutorOptions): Executor {
  return new Executor(opts);
}
