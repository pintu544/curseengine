"use client";

import { useCallback, useEffect, useState } from "react";
import type { GrimoireView } from "@/lib/grimoire";

interface GrimoireResponse { entries: GrimoireView[]; note: string }

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
    <section aria-labelledby="grim-h" className="rounded border border-zinc-800 p-3 lg:col-span-2">
      <h2 id="grim-h" className="mb-1 font-semibold">Grimoire</h2>
      <p data-testid="grimoire-note" className="mb-2 text-xs text-zinc-400">
        {data?.note ?? "Undoing an email marks its outbox message as retracted."}
      </p>
      <p className="mb-2 text-xs text-zinc-500">Entries are never edited or deleted while this host runs. A demo reset starts a new, empty log.</p>
      {error && <div role="alert" className="mb-2 rounded bg-red-950 p-2 text-sm text-red-200">{error}</div>}
      {(data?.entries.length ?? 0) === 0 ? (
        <p className="text-sm text-zinc-400">No executed actions yet.</p>
      ) : (
        <ol data-testid="grimoire-list" className="space-y-1">
          {data?.entries.map((e) => (
            <li key={e.id} data-testid="grimoire-entry" data-status={e.status} className={`rounded px-2 py-1 text-xs ${e.status === "reversed" ? "bg-zinc-800" : "bg-zinc-900"}`}>
              <span className="font-mono">{e.id}</span> {clock(e.at)} <strong>{e.kind}</strong> {e.target} by <span className="font-mono">{e.curse}</span>: <em>{e.status}</em>
              {e.reversalOf && <> (reverses <span className="font-mono">{e.reversalOf}</span>)</>}
              {e.reversed && <> (reversed)</>}
              <div className="text-zinc-400">{e.eventSummary}. Path: {e.path}</div>
              {e.reversible && <button type="button" data-testid="undo" onClick={() => void undo(e.id)} className="mt-1 rounded border border-zinc-600 px-2 py-0.5 hover:bg-zinc-800">Undo</button>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
