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
    <main className="mx-auto grid max-w-7xl items-start gap-4 p-4 lg:grid-cols-2">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4 lg:col-span-2">
        <h1 className="page-title flex flex-wrap items-baseline gap-x-3">Deadbeat <span className="tagline">invoice chasing you can read</span></h1>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="load-fixtures" onClick={() => void loadFixtures()} className="btn btn-secondary" title="Rebuilds the fixture invoices and installs the three tier curses. Discards all live state.">Load fixtures (discards all live state)</button>
          <button type="button" onClick={() => void reset()} className="btn btn-secondary" title="Restores fixtures and removes installed curses, the outbox and the grimoire">Reset demo (discards all live state)</button>
        </div>
      </header>
      <div aria-live="polite" className="lg:col-span-2 empty:hidden">
        {notice && <div data-testid="notice" className="rounded-lg border border-zinc-800 bg-zinc-900 px-3.5 py-3 text-sm text-zinc-300">{notice}</div>}
      </div>

      <section aria-labelledby="inv-h" className="panel">
        <h2 id="inv-h" className="panel-title mb-1">Invoices</h2>
        <p className="meta mb-3"><span aria-live="polite">Clock: <span data-testid="clock" className="tabular-nums">{snap ? when(snap.clock) : "..."}</span> (UTC, moves forward only)</span></p>
        <button type="button" data-testid="advance" disabled={busy} onClick={() => void advance()} className="btn btn-primary mb-4">Advance clock +1 day</button>
        <div className="scroll-thin overflow-x-auto">
        <table data-testid="invoice-list" className="w-full text-left text-sm">
          <thead><tr className="text-xs text-zinc-400"><th className="py-2 pr-3 font-medium">Client</th><th className="py-2 pr-3 text-right font-medium">Amount</th><th className="py-2 pr-3 text-right font-medium">Days overdue</th><th className="py-2 font-medium">Status</th></tr></thead>
          <tbody>
            {(snap?.invoices ?? []).map((i) => (
              <tr key={i.id} data-testid="invoice" data-invoice={i.id} data-status={i.status} className="border-t border-zinc-800">
                <td className="py-2.5 pr-3">{i.clientName} <span className="text-xs text-zinc-400">{i.id}</span></td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{money(i.amount)}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{i.daysOverdue}</td>
                <td className="py-2.5"><span className={`pill ${i.status === "escalated" ? "pill-amber" : "pill-zinc"}`}>{i.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      <section aria-labelledby="out-h" className="panel">
        <h2 id="out-h" className="panel-title mb-1">Outbox</h2>
        <p className="meta mb-3">In-app only. Nothing here is ever sent to a real address.</p>
        <div aria-live="polite">
        {outbox.length === 0 ? (
          <p className="empty-state">No messages yet.</p>
        ) : (
          <ul data-testid="outbox" aria-label="Outbox messages" tabIndex={0} className="scroll-thin max-h-96 overflow-y-auto pr-1">
            {outbox.map((o) => (
              <li key={o.id} data-testid="outbox-entry" data-retracted={o.retracted} className={`arrive border-t border-zinc-800 py-2.5 first:border-t-0 first:pt-0 ${o.retracted ? "opacity-80" : ""}`}>
                <span className={`text-xs tabular-nums text-zinc-400 ${o.retracted ? "line-through" : ""}`}>To <strong className="text-sm font-semibold text-zinc-100">{o.to}</strong> · <span>{o.template}</span> · invoice <span>{o.invoiceId}</span> · {when(o.at)}</span>
                {o.retracted && <span className="pill pill-red ml-2">retracted</span>}
                <div className="meta mt-0.5">{o.subject}</div>
              </li>
            ))}
          </ul>
        )}
        </div>
        <h2 className="panel-title mb-3 mt-5">Owner inbox</h2>
        <div aria-live="polite">
        {(snap?.escalations.length ?? 0) === 0 ? (
          <p className="empty-state">No escalations.</p>
        ) : (
          <ul data-testid="owner-inbox" className="space-y-2">
            {snap?.escalations.map((e) => (
              <li key={e.id} data-testid="escalation" className={`card-amber arrive tabular-nums ${e.retracted ? "opacity-80" : ""}`}>
                <strong className="font-semibold">Escalated to owner</strong> at {when(e.at)}: {e.summary}
                {e.retracted && <span className="pill pill-red ml-2">retracted</span>}
              </li>
            ))}
          </ul>
        )}
        </div>
      </section>

      <section aria-labelledby="editor-h" className="panel">
        <h2 id="editor-h" className="panel-title">Curse editor</h2>
        <label htmlFor="curse-source" className="field-label">Curse source</label>
        <textarea
          id="curse-source"
          data-testid="curse-source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          rows={4}
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "curse-error" : undefined}
          className={`editor mt-1 font-mono ${error ? "ring-2 ring-red-500" : ""}`}
        />
        {error && (
          <div id="curse-error" data-testid="curse-error" role="alert" className="alert-red mt-3">
            <div>Line {error.line}: {error.message}</div>
            <pre tabIndex={0} role="region" aria-label="Offending line" className="scroll-thin mt-1 overflow-x-auto font-mono text-xs"><span className="bg-red-800">{lines[error.line - 1] ?? ""}</span></pre>
          </div>
        )}
        <button type="button" data-testid="install" onClick={() => void install()} className="btn btn-primary mt-3">Install curse</button>
      </section>

      <section aria-labelledby="graph-h" className="panel">
        <h2 id="graph-h" className="panel-title">Rule graph</h2>
        <RuleGraph graph={graph} />
      </section>

      <Simulator curseId={graph?.name ?? "late-payers"} />
      <Grimoire version={`${snap?.clock ?? 0}-${outbox.length}-${snap?.escalations.length ?? 0}`} onUndone={refresh} />
    </main>
  );
}
