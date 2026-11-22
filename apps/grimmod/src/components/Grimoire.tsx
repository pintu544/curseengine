"use client";

import { useCallback, useEffect, useState } from "react";
import type { GrimoireView } from "@/lib/grimoire";
import type { SuppressedMessage } from "@/lib/host";

interface GrimoireResponse { entries: GrimoireView[]; suppressedTotal: number; suppressed: SuppressedMessage[]; suppressedTruncated: boolean; note: string }

const clock = (at: number) => new Date(at).toLocaleTimeString("en-GB");

/** Grimoire: the audit log, append-only within a host's lifetime. Undo appends a reversal entry; history is never edited. A fixture reset starts a new host lifetime. */
export function Grimoire({ version, onUndone }: { version: unknown; onUndone: () => void }) {
  const [data, setData] = useState<GrimoireResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData((await (await fetch("/api/grimoire")).json()) as GrimoireResponse);
    } catch {
      setError("Could not load the grimoire.");
    }
  }, []);
  useEffect(() => { void load(); }, [load, version]);

  const undo = useCallback(async (id: string) => {
    setError(null);
    try {
      const r = await fetch(`/api/grimoire/${encodeURIComponent(id)}/undo`, { method: "POST" });
      if (!r.ok) setError(((await r.json()) as { message?: string }).message ?? "Undo failed.");
      await load();
      onUndone();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    }
  }, [load, onUndone]);

  return (
    <section aria-labelledby="grim-h" className="panel lg:col-span-2">
      <h2 id="grim-h" className="panel-title mb-1">Grimoire</h2>
      <p data-testid="grimoire-note" aria-live="polite" className="prose-note mb-1">
        {data?.note ?? "Messages from a muted author produce no decision and no grimoire entry."}
        {data && data.suppressedTotal > 0 && <span data-testid="suppressed-count"> {data.suppressedTotal} suppressed while muted{data.suppressedTruncated ? ` (showing latest ${data.suppressed.length})` : ""}.</span>}
      </p>
      <p className="prose-note mb-3">Entries are never edited or deleted while this host runs. A demo reset starts a new, empty log.</p>
      {error && <div role="alert" className="alert-red mb-3">{error}</div>}
      <div aria-live="polite">
      {(data?.entries.length ?? 0) === 0 ? (
        <p className="empty-state">No executed actions yet.</p>
      ) : (
        <ol data-testid="grimoire-list" className="scroll-thin max-h-96 overflow-y-auto pr-1">
          {data?.entries.map((e) => (
            <li key={e.id} data-testid="grimoire-entry" data-status={e.status} className={`arrive border-t border-zinc-800 py-3 text-[13px] first:border-t-0 first:pt-0 ${e.status === "reversed" ? "text-zinc-400" : "text-zinc-200"}`}>
              <span className="text-zinc-400">{e.id}</span> <span className="tabular-nums text-zinc-400">{clock(e.at)}</span> <strong className="font-semibold">{e.kind}</strong> {e.target} by <span className="text-zinc-400">{e.curse}</span>: <em>{e.status}</em>
              {e.reversalOf && <> (reverses <span className="text-zinc-400">{e.reversalOf}</span>)</>}
              {e.reversed && <> (reversed)</>}
              <div className="meta mt-0.5">{e.eventSummary}. Path: {e.path}</div>
              {e.reversible && <button type="button" data-testid="undo" onClick={() => void undo(e.id)} className="btn btn-secondary btn-sm mt-2">Undo</button>}
            </li>
          ))}
        </ol>
      )}
      </div>
    </section>
  );
}
