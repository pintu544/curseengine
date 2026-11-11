import type { RuleGraph as Graph } from "@/lib/graph";

const KIND_STYLE: Record<string, string> = {
  trigger: "border-sky-500 bg-sky-950/60",
  condition: "border-amber-500 bg-amber-950/50",
  action: "border-emerald-500 bg-emerald-950/50",
};

export function RuleGraph({ graph }: { graph: Graph | null }) {
  if (!graph) {
    return <p data-testid="graph-empty" className="text-sm text-zinc-400">Install a curse to see its rule graph.</p>;
  }
  const edgeInto = new Map(graph.edges.map((e) => [e.to, e]));
  return (
    <ol data-testid="rule-graph" aria-label={`Rule graph for ${graph.name}`} className="space-y-1">
      <li className="text-sm font-semibold text-zinc-300">curse {graph.name}</li>
      {graph.nodes.map((n) => {
        const edge = edgeInto.get(n.id);
        return (
          <li key={n.id} className="list-none">
            {edge && (
              <div className="ml-6 flex items-center gap-2 py-0.5 text-xs text-zinc-400" aria-hidden="true">
                <span>↓</span>
                {edge.label && <span className="rounded bg-zinc-800 px-1.5 uppercase">{edge.label}</span>}
              </div>
            )}
            <div data-testid={`node-${n.id}`} data-kind={n.kind} className={`rounded border-l-4 px-3 py-2 ${KIND_STYLE[n.kind] ?? ""}`}>
              <div className="text-xs uppercase tracking-wide text-zinc-400">{n.label}</div>
              <div className="font-mono text-sm">{n.detail}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
