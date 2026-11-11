"use client";

import { useCallback, useState } from "react";
import type { SimulationReport } from "@curseengine/engine";

interface SimResponse {
  summaryLine: string;
  falsePositives: string[] | null;
  report: SimulationReport;
  message?: string;
}

const clock = (at: number) => new Date(at).toLocaleString("en-GB", { timeZone: "UTC" });

/** Simulator view: runs the installed curse over the fixture history with a recording stub. Changes nothing live. */
export function Simulator({ curseId }: { curseId: string }) {
  const [res, setRes] = useState<SimResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/curses/${encodeURIComponent(curseId)}/simulate`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const body = (await r.json()) as SimResponse;
      if (r.ok) setRes(body);
      else setError(body.message ?? "Simulation failed.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [curseId]);

  const report = res?.report;
  return (
    <section aria-labelledby="sim-h" className="rounded border border-zinc-800 p-3 lg:col-span-2">
      <h2 id="sim-h" className="mb-1 font-semibold">Simulator</h2>
      <p className="mb-2 text-xs text-zinc-400">Replays the fixture history through curse <span className="font-mono">{curseId}</span> with a recording stub. Nothing here touches live chat. Install the curse first.</p>
      <button type="button" data-testid="run-sim" disabled={busy} onClick={() => void run()} className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50">Run simulation</button>
      {error && <div role="alert" className="mt-2 rounded bg-red-950 p-2 text-sm text-red-200">{error}</div>}
      {res && report && (
        <div className="mt-3">
          <p data-testid="sim-summary" className="text-lg font-semibold">{res.summaryLine}</p>
          <p className="text-xs text-zinc-400">{report.summary.events} events, {report.summary.matchedRuns} matched runs, {report.summary.suppressed} suppressed while muted.</p>
          <h3 className="mt-3 text-sm font-semibold">Per target</h3>
          <ul data-testid="sim-targets" className="text-sm">
            {report.summary.perTarget.map((t) => <li key={`${t.kind}-${t.target}`} className="font-mono text-xs">{t.kind} {t.target} x{t.count}</li>)}
            {report.summary.perTarget.length === 0 && <li className="text-zinc-400">No actions would be taken.</li>}
          </ul>
          <h3 className="mt-3 text-sm font-semibold">Decisions</h3>
          <table data-testid="sim-decisions" className="mt-1 w-full text-left text-xs">
            <thead><tr className="text-zinc-400"><th className="pr-2">Event</th><th className="pr-2">Time (UTC)</th><th className="pr-2">Outcome</th><th>Actions</th></tr></thead>
            <tbody>
              {report.decisions.filter((d) => d.matched).map((d) => (
                <tr key={`${d.curse}-${d.eventId}`} className="border-t border-zinc-800">
                  <td className="pr-2 font-mono">{d.eventId}</td>
                  <td className="pr-2">{clock(d.at)}</td>
                  <td className="pr-2">{d.outcome}</td>
                  <td className="font-mono">{d.actions.map((a) => `${a.kind} ${a.target ?? "(none)"}: ${a.status}`).join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-zinc-400">Events that matched no condition ({report.decisions.filter((d) => !d.matched).length}) are recorded in the report but not listed here.</p>
          {report.suppressed.length > 0 && (
            <p className="mt-2 text-xs text-zinc-400">Suppressed while muted (no decision): {report.suppressed.map((s) => `${s.eventId} (${s.author})`).join(", ")}.</p>
          )}
        </div>
      )}
    </section>
  );
}
