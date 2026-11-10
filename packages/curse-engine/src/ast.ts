/** Typed AST for the frozen CurseEngine grammar (DESIGN.md). Pure data, JSON-serialisable. */

export interface Loc {
  line: number; // 1-based
  column: number; // 1-based
}

export type DurationUnit = "minute" | "hour" | "day" | "week";

export interface Duration {
  amount: number;
  unit: DurationUnit;
}

export type Value =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "word"; value: string };

export interface CountCondition {
  kind: "count";
  loc: Loc;
  event: string;
  /** `by same <field>`, e.g. "author" */
  bySameField?: string;
  /** trailing `flagged` modifier */
  flagged: boolean;
  op: ">=";
  threshold: number;
  window: Duration;
}

export type CompareOp = ">" | ">=" | "<" | "<=" | "=";

export interface CompareCondition {
  kind: "compare";
  loc: Loc;
  field: string;
  op: CompareOp;
  value: Value;
}

export interface TextCondition {
  kind: "text";
  loc: Loc;
  field: string;
  op: "contains" | "matches";
  pattern: string;
}

export type Condition = CountCondition | CompareCondition | TextCondition;

/** Flat, source-ordered chain. Precedence/association is NOT decided here (executor, T1.4). */
export interface Conditions {
  first: Condition;
  rest: { connector: "and" | "or"; condition: Condition }[];
}

export interface EventTrigger {
  kind: "event";
  loc: Loc;
  event: string;
  where?: Conditions;
}
export interface TimerTrigger {
  kind: "timer";
  loc: Loc;
  interval: Duration;
  where?: Conditions;
}
export interface WebhookTrigger {
  kind: "webhook";
  loc: Loc;
  path: string;
}
export type Trigger = EventTrigger | TimerTrigger | WebhookTrigger;

export interface MuteAction {
  kind: "mute";
  loc: Loc;
  target: string;
  duration: Duration;
}
export interface PostAction {
  kind: "post";
  loc: Loc;
  message: string;
  channel: string;
}
export interface EmailAction {
  kind: "email";
  loc: Loc;
  template: string;
  to: string;
}
export interface EscalateAction {
  kind: "escalate";
  loc: Loc;
  to: "owner";
}
export type Action = MuteAction | PostAction | EmailAction | EscalateAction;

export interface Curse {
  kind: "curse";
  loc: Loc;
  name: string;
  trigger: Trigger;
  actions: Action[]; // at least one
}
