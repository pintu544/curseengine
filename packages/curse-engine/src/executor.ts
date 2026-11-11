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
  /**
   * The resolved target (muted author, email recipient, channel, "owner"). `null` when the target
   * was never resolved (field missing on the event, or the action never ran). It is never a field name.
   */
  target: string | null;
  /** For actions whose target is read from an event field: the NAME of that field, when `target` is null. */
  targetField?: string;
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
  /**
   * `partial`: the run executed but no failure occurred and at least one action was skipped
   * (for example its target field was missing), so not every action was taken.
   */
  outcome: "no-match" | "executed" | "partial" | "skipped-quota" | "failed";
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

/** Own-property check only: a capability inherited through the prototype chain is never declared. */
export function hasCapability(caps: Capabilities, kind: CapabilityName): boolean {
  return Object.prototype.hasOwnProperty.call(caps, kind) && typeof caps[kind] === "function";
}

const dur = (d: Duration) => `${d.amount} ${d.unit}${d.amount === 1 ? "" : "s"}`;

export class Executor {
  /** Count history, bounded: per event type, sorted by `at`. See retainEvent/prune. */
  private byType = new Map<string, EngineEvent[]>();
  /** Lazily built per (type, field) index: field value -> events sorted by `at`. Dropped on prune. */
  private byGroup = new Map<string, Map<string, EngineEvent[]>>();
  private maxAt = -Infinity;
  private sincePrune = 0;
  private retained = 0;
  private keptAtPrune = 0;
  private runs = new Map<string, number[]>();
  /** Every decision record produced, in order. */
  readonly records: DecisionRecord[] = [];

  constructor(private readonly opts: ExecutorOptions) {}

  /** Process one event against all curses whose trigger matches. Throws UndeclaredCapabilityError on sandbox violation. */
  async handle(event: EngineEvent): Promise<DecisionRecord[]> {
    this.retainEvent(event);
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

  /** Largest count window (ms) among installed curses, or 0 when no installed curse has a count condition. */
  private maxCountWindow(): number {
    let max = 0;
    for (const curse of this.opts.curses) {
      const w = curse.trigger.kind === "webhook" ? undefined : curse.trigger.where;
      if (!w) continue;
      for (const c of [w.first, ...w.rest.map((r) => r.condition)]) if (c.kind === "count") max = Math.max(max, durationMs(c.window));
    }
    return max;
  }

  private retainEvent(event: EngineEvent): void {
    if (event.type === "tick") return;
    const window = this.maxCountWindow();
    if (window === 0) {
      // No installed curse can ask for a count, so nothing needs to be remembered.
      if (this.retained > 0) { this.byType.clear(); this.byGroup.clear(); this.retained = 0; }
      return;
    }
    this.maxAt = Math.max(this.maxAt, event.at);
    insertSorted(this.byType, event.type, event);
    this.retained += 1;
    for (const [key, groups] of this.byGroup) {
      const [type, field] = key.split("\u0000") as [string, string];
      if (type !== event.type) continue;
      const v = event.fields[field];
      if (v !== undefined) insertSorted(groups, groupKey(v), event);
    }
    if (++this.sincePrune >= Math.max(1024, this.keptAtPrune)) this.prune(window);
  }

  /** Drops events no count condition can reach: at <= (newest event time - largest window). */
  private prune(window: number): void {
    const cutoff = this.maxAt - window;
    this.sincePrune = 0;
    this.retained = 0;
    for (const [type, arr] of this.byType) {
      const kept = arr.slice(lowerIndex(arr, cutoff));
      if (kept.length === 0) this.byType.delete(type);
      else { this.byType.set(type, kept); this.retained += kept.length; }
    }
    this.byGroup.clear();
    this.keptAtPrune = this.retained;
  }

  private groupIndex(type: string, field: string): Map<string, EngineEvent[]> {
    const key = `${type}\u0000${field}`;
    let groups = this.byGroup.get(key);
    if (!groups) {
      groups = new Map();
      for (const ev of this.byType.get(type) ?? []) {
        const v = ev.fields[field];
        if (v !== undefined) insertSorted(groups, groupKey(v), ev);
      }
      this.byGroup.set(key, groups);
    }
    return groups;
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
    const missing = curse.actions.find((a) => !hasCapability(this.opts.capabilities, a.kind));
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
    return { ...base, outcome: failed ? "failed" : actions.some((r) => r.status === "skipped") ? "partial" : "executed", quota: { used: recent.length, limit }, actions };
  }

  private rec(a: Action, status: ActionRecord["status"], reason: string): ActionRecord {
    // Field-targeted actions have no resolved target here, so the record carries the field name separately.
    if (a.kind === "mute") return { kind: a.kind, target: null, targetField: a.target, status, reason };
    if (a.kind === "email") return { kind: a.kind, target: null, targetField: a.to, status, reason };
    return { kind: a.kind, target: a.kind === "post" ? a.channel : a.to, status, reason };
  }

  /** Dispatch-time capability lookup: own properties only, so an inherited function can never fire. */
  private cap<K extends CapabilityName>(kind: K): NonNullable<Capabilities[K]> {
    const caps = this.opts.capabilities;
    if (!hasCapability(caps, kind)) throw new Error(`undeclared capability "${kind}"`);
    return (caps[kind] as (...a: never[]) => unknown).bind(caps) as NonNullable<Capabilities[K]>;
  }

  private async run(curse: Curse, a: Action, e: EngineEvent): Promise<ActionRecord> {
    const base = { curse: curse.name, eventId: e.id };
    switch (a.kind) {
      case "mute": {
        const who = e.fields[a.target];
        if (who === undefined) return { kind: "mute", target: null, targetField: a.target, status: "skipped", reason: `event has no field "${a.target}"` };
        await this.cap("mute")({ ...base, target: String(who), durationMs: durationMs(a.duration), duration: a.duration });
        return { kind: "mute", target: String(who), status: "taken", reason: `muted for ${dur(a.duration)}` };
      }
      case "post":
        await this.cap("post")({ ...base, message: a.message, channel: a.channel });
        return { kind: "post", target: a.channel, status: "taken", reason: "posted" };
      case "email": {
        const to = e.fields[a.to];
        if (to === undefined) return { kind: "email", target: null, targetField: a.to, status: "skipped", reason: `event has no field "${a.to}"` };
        await this.cap("email")({ ...base, template: a.template, to: String(to) });
        return { kind: "email", target: String(to), status: "taken", reason: `sent template ${a.template}` };
      }
      case "escalate":
        await this.cap("escalate")({ ...base, to: "owner" });
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
    let pool: EngineEvent[] = [];
    if (!c.bySameField) pool = this.byType.get(c.event) ?? [];
    else if (group !== undefined) pool = this.groupIndex(c.event, c.bySameField).get(groupKey(group)) ?? [];
    // Window (at - window, at]: binary-search the sorted pool, then count the slice.
    let n = 0;
    for (let i = lowerIndex(pool, from); i < pool.length && pool[i]!.at <= e.at; i++) {
      if (!c.flagged || pool[i]!.flagged === true) n++;
    }
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
    const risk = catastrophicShape(c.pattern);
    if (risk) return { kind: "text", description, observed: s, expected: c.pattern, result: false, note: `pattern rejected: ${risk}` };
    const capped = s.length > MATCH_SUBJECT_CAP;
    try {
      const result = new RegExp(c.pattern).test(capped ? s.slice(0, MATCH_SUBJECT_CAP) : s);
      return { kind: "text", description, observed: s, expected: c.pattern, result, ...(capped ? { note: `matched against the first ${MATCH_SUBJECT_CAP} characters only` } : {}) };
    } catch {
      return { kind: "text", description, observed: s, expected: c.pattern, result: false, note: "invalid regular expression" };
    }
  }
}

/** `matches` only considers this many leading characters of the subject. */
export const MATCH_SUBJECT_CAP = 10_000;

const groupKey = (v: string | number | boolean): string => `${typeof v}:${String(v)}`;

/** First index whose `at` is strictly greater than `t` (arrays are sorted by `at`). */
function lowerIndex(arr: EngineEvent[], t: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]!.at > t) hi = mid; else lo = mid + 1;
  }
  return lo;
}

/** Insert keeping `at` order; ties keep arrival order. Appends in O(1) for in-order streams. */
function insertSorted<K>(m: Map<K, EngineEvent[]>, key: K, ev: EngineEvent): void {
  let arr = m.get(key);
  if (!arr) { arr = []; m.set(key, arr); }
  let i = arr.length;
  while (i > 0 && arr[i - 1]!.at > ev.at) i--;
  arr.splice(i, 0, ev);
}

/**
 * Static ReDoS screen for `matches` patterns. Returns a reason when the pattern repeats a group
 * that itself contains a repetition (`(a+)+`, `(a*)*`, `(\\w+\\s?)*`), or repeats an alternation whose
 * branches overlap (`(a|a)+`, `(a|aa)+`). Everything else is allowed.
 */
export function catastrophicShape(pattern: string): string | undefined {
  interface G { rep: boolean; alts: string[]; cur: string }
  const stack: G[] = [];
  const top = (): G | undefined => stack[stack.length - 1];
  const quantAt = (i: number): { repeating: boolean; len: number } | undefined => {
    const ch = pattern[i];
    if (ch === "*" || ch === "+") return { repeating: true, len: 1 };
    if (ch === "{") {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i, i + 24));
      if (!m) return undefined;
      const max = m[2] === undefined ? Number(m[1]) : m[3] === "" ? Infinity : Number(m[3]);
      return { repeating: max > 1, len: m[0].length };
    }
    return undefined;
  };
  const overlap = (alts: string[]): boolean => {
    for (let i = 0; i < alts.length; i++) {
      if (/^[.[\\(]/.test(alts[i]!)) return true;
      for (let j = i + 1; j < alts.length; j++) if (alts[i]!.startsWith(alts[j]!) || alts[j]!.startsWith(alts[i]!)) return true;
    }
    return false;
  };
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "\\") { const t = top(); if (t) t.cur += pattern.slice(i, i + 2); i++; continue; }
    if (ch === "[") {
      let j = i + 1;
      while (j < pattern.length && pattern[j] !== "]") j += pattern[j] === "\\" ? 2 : 1;
      const t = top(); if (t) t.cur += pattern.slice(i, j + 1);
      i = j; continue;
    }
    if (ch === "(") {
      const m = /^\(\?(?:<[=!]|<[^>]*>|[:=!])/.exec(pattern.slice(i, i + 64));
      stack.push({ rep: false, alts: [], cur: "" });
      if (m) i += m[0].length - 1;
      continue;
    }
    if (ch === "|") { const t = top(); if (t) { t.alts.push(t.cur); t.cur = ""; } continue; }
    if (ch === ")") {
      const g = stack.pop();
      if (!g) continue;
      g.alts.push(g.cur);
      const q = quantAt(i + 1);
      if (q?.repeating) {
        if (g.rep) return "nested quantifiers over a group (possible catastrophic backtracking)";
        if (g.alts.length > 1 && overlap(g.alts)) return "repeated alternation with overlapping branches (possible catastrophic backtracking)";
      }
      const parent = top();
      if (parent) { parent.rep ||= g.rep || !!q?.repeating; parent.cur += "(g)"; }
      continue;
    }
    const q = quantAt(i);
    if (q) { const t = top(); if (t && q.repeating) t.rep = true; i += q.len - 1; continue; }
    const t = top(); if (t) t.cur += ch;
  }
  return undefined;
}

export function createExecutor(opts: ExecutorOptions): Executor {
  return new Executor(opts);
}
