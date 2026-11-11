"use client";

import { useCallback, useEffect, useState } from "react";
import type { DecisionRecord } from "@curseengine/engine";
import { EXAMPLE_CURSE } from "@/lib/fixtures";
import type { RuleGraph as Graph } from "@/lib/graph";
import type { InvoiceSnapshot } from "@/lib/invoice-state";
import { Grimoire } from "./Grimoire";
import { RuleGraph } from "./RuleGraph";
import { Simulator } from "./Simulator";

interface ParseError {
  line: number;
  message: string;
}

interface EventsResponse extends InvoiceSnapshot {
  curses: string[];
  latest: DecisionRecord | null;
}

const when = (at: number) => new Date(at).toLocaleString("en-GB", { timeZone: "UTC" });
const money = (n: number) => `£${n.toFixed(2)}`;

export function Deadbeat() {
  const [snap, setSnap] = useState<InvoiceSnapshot | null>(null);
  const [source, setSource] = useState(EXAMPLE_CURSE);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<ParseError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void fetch("/api/events").then((r) => r.json()).then((d: EventsResponse) => setSnap(d)).catch(() => undefined);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const install = useCallback(async (src: string = source) => {
    try {
      const res = await fetch("/api/curses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: src }) });
      const body = await res.json();
      if (res.status === 201) {
        setGraph((body as { graph: Graph }).graph);
        setError(null);
      } else {
        setError(body as ParseError);
      }
    } catch {
      setError({ line: 1, message: "Could not reach the server. Check your connection and try again." });
    }
  }, [source]);

  const advance = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ days: 1 }) });
      if (res.ok) setSnap((await res.json()) as InvoiceSnapshot);
    } catch {
      // Keep the current view if the server cannot be reached.
    } finally {
      setBusy(false);
    }
  }, []);

  const loadFixtures = useCallback(async () => {
    try {
      const d = (await (await fetch("/api/fixtures", { method: "POST" })).json()) as { state: InvoiceSnapshot; curses: string[] };
      setSnap(d.state);
      setGraph(null);
      setNotice(`Fixtures loaded. Live state discarded; installed curses: ${d.curses.join(", ")}.`);
    } catch {
      // Keep the current view if the server cannot be reached.
    }
  }, []);

  const reset = useCallback(async () => {
    try {
      const d = (await (await fetch("/api/reset", { method: "POST" })).json()) as { state: InvoiceSnapshot; note: string };
      setSnap(d.state);
      setGraph(null);
      setNotice(d.note);
    } catch {
      // Keep the current view if the server cannot be reached.
    }
  }, []);

  const lines = source.split("\n");
  const outbox = snap?.outbox ?? [];

  return (
    <main className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-2">
      <header className="lg:col-span-2 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">Deadbeat <span className="text-sm font-normal text-zinc-400">invoice chasing you can read</span></h1>
        <div className="flex gap-2">
          <button type="button" data-testid="load-fixtures" onClick={() => void loadFixtures()} className="rounded border border-zinc-600 px-3 py-1 text-sm hover:bg-zinc-800" title="Rebuilds the fixture invoices and installs the three tier curses. Discards all live state.">Load fixtures (discards all live state)</button>
          <button type="button" onClick={() => void reset()} className="rounded border border-zinc-600 px-3 py-1 text-sm hover:bg-zinc-800" title="Restores fixtures and removes installed curses, the outbox and the grimoire">Reset demo (discards all live state)</button>
        </div>
      </header>
      <div aria-live="polite" className="lg:col-span-2 empty:hidden">
        {notice && <div data-testid="notice" className="rounded bg-zinc-900 px-3 py-2 text-sm text-zinc-300">{notice}</div>}
      </div>

      <section aria-labelledby="inv-h" className="rounded border border-zinc-800 p-3">
        <h2 id="inv-h" className="mb-1 font-semibold">Invoices</h2>
        <p className="mb-2 text-xs text-zinc-400"><span aria-live="polite">Clock: <span data-testid="clock">{snap ? when(snap.clock) : "..."}</span> (UTC, moves forward only)</span></p>
        <button type="button" data-testid="advance" disabled={busy} onClick={() => void advance()} className="mb-3 rounded bg-sky-700 px-3 py-1.5 text-sm font-semibold hover:bg-sky-800 disabled:opacity-50">Advance clock +1 day</button>
        <table data-testid="invoice-list" className="w-full text-left text-sm">
          <thead><tr className="text-xs text-zinc-400"><th className="pr-2">Client</th><th className="pr-2">Amount</th><th className="pr-2">Days overdue</th><th>Status</th></tr></thead>
          <tbody>
            {(snap?.invoices ?? []).map((i) => (
              <tr key={i.id} data-testid="invoice" data-invoice={i.id} data-status={i.status} className="border-t border-zinc-800">
                <td className="pr-2">{i.clientName} <span className="font-mono text-xs text-zinc-400">{i.id}</span></td>
                <td className="pr-2">{money(i.amount)}</td>
                <td className="pr-2">{i.daysOverdue}</td>
                <td>{i.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="out-h" className="rounded border border-zinc-800 p-3">
        <h2 id="out-h" className="mb-1 font-semibold">Outbox</h2>
        <p className="mb-2 text-xs text-zinc-400">In-app only. Nothing here is ever sent to a real address.</p>
        <div aria-live="polite">
        {outbox.length === 0 ? (
          <p className="text-sm text-zinc-400">No messages yet.</p>
        ) : (
          <ul data-testid="outbox" aria-label="Outbox messages" tabIndex={0} className="max-h-96 space-y-1 overflow-y-auto">
            {outbox.map((o) => (
              <li key={o.id} data-testid="outbox-entry" data-retracted={o.retracted} className={`rounded bg-zinc-900 px-2 py-1 text-xs ${o.retracted ? "opacity-80" : ""}`}>
                <span className={o.retracted ? "line-through" : ""}>To <strong>{o.to}</strong> · <span className="font-mono">{o.template}</span> · invoice <span className="font-mono">{o.invoiceId}</span> · {when(o.at)}</span>
                {o.retracted && <span className="ml-2 rounded bg-red-800 px-1.5">retracted</span>}
                <div className="text-zinc-400">{o.subject}</div>
              </li>
            ))}
          </ul>
        )}
        </div>
        <h2 className="mb-1 mt-4 font-semibold">Owner inbox</h2>
        <div aria-live="polite">
        {(snap?.escalations.length ?? 0) === 0 ? (
          <p className="text-sm text-zinc-400">No escalations.</p>
        ) : (
          <ul data-testid="owner-inbox" className="space-y-1">
            {snap?.escalations.map((e) => (
              <li key={e.id} data-testid="escalation" className={`rounded bg-amber-950 px-3 py-2 text-sm text-amber-100 ${e.retracted ? "opacity-80" : ""}`}>
                <strong>Escalated to owner</strong> at {when(e.at)}: {e.summary}
                {e.retracted && <span className="ml-2 rounded bg-red-800 px-1.5 text-xs">retracted</span>}
              </li>
            ))}
          </ul>
        )}
        </div>
      </section>

      <section aria-labelledby="editor-h" className="rounded border border-zinc-800 p-3">
        <h2 id="editor-h" className="mb-2 font-semibold">Curse editor</h2>
        <label htmlFor="curse-source" className="text-xs text-zinc-400">Curse source</label>
        <textarea
          id="curse-source"
          data-testid="curse-source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          rows={4}
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "curse-error" : undefined}
          className={`mt-1 w-full rounded bg-zinc-900 p-2 font-mono text-sm ${error ? "ring-2 ring-red-500" : ""}`}
        />
        {error && (
          <div id="curse-error" data-testid="curse-error" role="alert" className="mt-2 rounded bg-red-950 p-2 text-sm text-red-200">
            <div>Line {error.line}: {error.message}</div>
            <pre tabIndex={0} role="region" aria-label="Offending line" className="mt-1 overflow-x-auto font-mono text-xs"><span className="bg-red-800">{lines[error.line - 1] ?? ""}</span></pre>
          </div>
        )}
        <button type="button" data-testid="install" onClick={() => void install()} className="mt-2 rounded bg-sky-700 px-3 py-1.5 text-sm font-semibold hover:bg-sky-800">Install curse</button>
      </section>

      <section aria-labelledby="graph-h" className="rounded border border-zinc-800 p-3">
        <h2 id="graph-h" className="mb-2 font-semibold">Rule graph</h2>
        <RuleGraph graph={graph} />
      </section>

      <Simulator curseId={graph?.name ?? "late-payers"} />
      <Grimoire version={`${snap?.clock ?? 0}-${outbox.length}-${snap?.escalations.length ?? 0}`} onUndone={refresh} />
    </main>
  );
}
