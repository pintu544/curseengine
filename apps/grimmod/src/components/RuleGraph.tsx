import type { RuleGraph as Graph } from "@/lib/graph";

const KIND_STYLE: Record<string, string> = {
  trigger: "border-violet-700 bg-violet-950/50",
  condition: "border-amber-800 bg-amber-950/50",
  action: "border-emerald-800 bg-emerald-950/50",
};

export function RuleGraph({ graph }: { graph: Graph | null }) {
  if (!graph) {
    return <p data-testid="graph-empty" className="empty-state">Install a curse to see its rule graph.</p>;
  }
  const edgeInto = new Map(graph.edges.map((e) => [e.to, e]));
  return (
    <ol data-testid="rule-graph" aria-label={`Rule graph for ${graph.name}`} className="space-y-1">
      <li className="mb-2 font-mono text-sm font-semibold text-zinc-300">curse {graph.name}</li>
      {graph.nodes.map((n) => {
        const edge = edgeInto.get(n.id);
        return (
          <li key={n.id} className="list-none">
            {edge && (
              <div className="ml-6 flex items-center gap-2 py-0.5 text-xs text-zinc-400" aria-hidden="true">
                <span>↓</span>
                {edge.label && <span className="pill pill-zinc uppercase">{edge.label}</span>}
              </div>
            )}
            <div data-testid={`node-${n.id}`} data-kind={n.kind} className={`rounded-lg border px-3.5 py-2.5 ${KIND_STYLE[n.kind] ?? "border-zinc-800"}`}>
              <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">{n.label}</div>
              <div className="mt-0.5 font-mono text-sm text-zinc-100">{n.detail}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
