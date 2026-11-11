import type { Action, Condition, Curse, Duration } from "@curseengine/engine";

export type GraphNodeKind = "curse" | "trigger" | "condition" | "action";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  detail?: string;
  line: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** "and" / "or" between consecutive conditions; absent otherwise. */
  label?: string;
}

export interface RuleGraph {
  name: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const dur = (d: Duration) => `${d.amount} ${d.unit}${d.amount === 1 ? "" : "s"}`;

function describeCondition(c: Condition): string {
  switch (c.kind) {
    case "count":
      return `count(${c.event}${c.bySameField ? ` by same ${c.bySameField}` : ""}${c.flagged ? " flagged" : ""}) ${c.op} ${c.threshold} within ${dur(c.window)}`;
    case "compare":
      return `${c.field} ${c.op} ${c.value.value}`;
    case "text":
      return `${c.field} ${c.op} "${c.pattern}"`;
  }
}

function describeAction(a: Action): { label: string; detail: string } {
  switch (a.kind) {
    case "mute":
      return { label: "mute", detail: `mute ${a.target} for ${dur(a.duration)}` };
    case "post":
      return { label: "post", detail: `post "${a.message}" to ${a.channel}` };
    case "email":
      return { label: "email", detail: `email template ${a.template} to ${a.to}` };
    case "escalate":
      return { label: "escalate", detail: `escalate to ${a.to}` };
  }
}

/**
 * Turns a Curse AST into nodes and edges: trigger -> conditions (source order, with and/or
 * connectors on the edges) -> actions (chained in order). Pure and JSON-serialisable.
 */
export function curseToGraph(curse: Curse): RuleGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const t = curse.trigger;

  const triggerLabel = t.kind === "event" ? `when ${t.event}` : t.kind === "timer" ? `every ${dur(t.interval)}` : `webhook ${t.path}`;
  nodes.push({ id: "trigger", kind: "trigger", label: "Trigger", detail: triggerLabel, line: t.loc.line });
  let prev = "trigger";

  if (t.kind !== "webhook" && t.where) {
    const chain = [{ connector: undefined as "and" | "or" | undefined, condition: t.where.first }, ...t.where.rest];
    chain.forEach((entry, i) => {
      const id = `condition-${i + 1}`;
      nodes.push({ id, kind: "condition", label: `Condition ${i + 1}`, detail: describeCondition(entry.condition), line: entry.condition.loc.line });
      edges.push({ from: prev, to: id, ...(entry.connector ? { label: entry.connector } : {}) });
      prev = id;
    });
  }

  curse.actions.forEach((a, i) => {
    const id = `action-${i + 1}`;
    const d = describeAction(a);
    nodes.push({ id, kind: "action", label: `Action ${i + 1}: ${d.label}`, detail: d.detail, line: a.loc.line });
    edges.push({ from: prev, to: id });
    prev = id;
  });

  return { name: curse.name, nodes, edges };
}
