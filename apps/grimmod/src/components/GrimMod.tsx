"use client";

import { useCallback, useEffect, useState } from "react";
import type { DecisionRecord } from "@curseengine/engine";
import type { ChatSnapshot } from "@/lib/chat-state";
import { EXAMPLE_CURSE, RAID_BOT } from "@/lib/fixtures";
import type { RuleGraph as Graph } from "@/lib/graph";
import { RuleGraph } from "./RuleGraph";

interface ParseError {
  line: number;
  message: string;
}

const BURST_SIZE = 5;
const BURST_GAP_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clock = (at: number) => new Date(at).toLocaleTimeString("en-GB");

export function GrimMod() {
  const [chat, setChat] = useState<ChatSnapshot | null>(null);
  const [source, setSource] = useState(EXAMPLE_CURSE);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<ParseError | null>(null);
  const [latest, setLatest] = useState<DecisionRecord | null>(null);
  const [author, setAuthor] = useState("mira");
  const [text, setText] = useState("");
  const [flagged, setFlagged] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/events").then((r) => r.json()).then((d: { chat: ChatSnapshot; latest: DecisionRecord | null }) => {
      setChat(d.chat);
      setLatest(d.latest);
    });
  }, []);

  const install = useCallback(async () => {
    const res = await fetch("/api/curses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source }) });
    const body = await res.json();
    if (res.status === 201) {
      setGraph((body as { graph: Graph }).graph);
      setError(null);
    } else {
      setError(body as ParseError);
    }
  }, [source]);

  const send = useCallback(async (m: { author: string; text: string; flagged: boolean }) => {
    const res = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(m) });
    const body = (await res.json()) as { chat?: ChatSnapshot; decisions?: DecisionRecord[] };
    if (body.chat) setChat(body.chat);
    if (body.decisions && body.decisions.length > 0) setLatest(body.decisions[body.decisions.length - 1] ?? null);
  }, []);

  const burst = useCallback(async () => {
    setBusy(true);
    for (let i = 1; i <= BURST_SIZE; i++) {
      await send({ author: RAID_BOT, text: `RAID ${i}/${BURST_SIZE}: join now http://spam.invalid/${i}`, flagged: true });
      if (i < BURST_SIZE) await sleep(BURST_GAP_MS);
    }
    setBusy(false);
  }, [send]);

  const reset = useCallback(async () => {
    const d = (await (await fetch("/api/reset", { method: "POST" })).json()) as { chat: ChatSnapshot };
    setChat(d.chat);
    setLatest(null);
    setGraph(null);
  }, []);

  const lines = source.split("\n");
  const activeMutes = chat?.mutes ?? [];
  const mutedNow = new Set(activeMutes.filter((m) => m.until > Date.now()).map((m) => m.author));

  return (
    <main className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-2">
      <header className="lg:col-span-2 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">GrimMod <span className="text-sm font-normal text-zinc-400">chat moderation you can read</span></h1>
        <button type="button" onClick={() => void reset()} className="rounded border border-zinc-600 px-3 py-1 text-sm hover:bg-zinc-800">Reset demo</button>
      </header>

      <section aria-labelledby="chat-h" className="rounded border border-zinc-800 p-3">
        <h2 id="chat-h" className="mb-2 font-semibold">Chat #general</h2>
        {[...mutedNow].map((a) => (
          <div key={a} data-testid="mute-banner" role="status" className="mb-2 rounded bg-red-950 px-3 py-2 text-sm text-red-200">
            {a} is muted until {clock(activeMutes.find((m) => m.author === a)?.until ?? 0)} (1 day by the curse).
          </div>
        ))}
        <ul data-testid="chat-list" className="max-h-96 space-y-1 overflow-y-auto">
          {(chat?.messages ?? []).map((m) => (
            <li
              key={m.id}
              data-testid="chat-message"
              data-author={m.author}
              data-flagged={m.flagged}
              data-muted={m.muted}
              className={`rounded px-2 py-1 text-sm ${m.system ? "bg-indigo-950 italic" : "bg-zinc-900"} ${m.muted ? "opacity-50 line-through" : ""}`}
            >
              <span className="font-semibold">{m.author}</span>
              {m.flagged && <span className="ml-2 rounded bg-orange-700 px-1.5 text-xs">flagged</span>}
              {m.muted && <span className="ml-2 rounded bg-red-700 px-1.5 text-xs no-underline">muted</span>}
              {mutedNow.has(m.author) && !m.muted && <span className="ml-2 rounded bg-red-900 px-1.5 text-xs">author muted</span>}
              <span className="ml-2 text-xs text-zinc-500">{clock(m.at)}</span>
              <div>{m.text}</div>
            </li>
          ))}
        </ul>
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { void send({ author, text, flagged }); setText(""); } }}>
          <label className="text-xs">Author<input aria-label="Author" value={author} onChange={(e) => setAuthor(e.target.value)} className="mt-1 block w-24 rounded bg-zinc-800 px-2 py-1 text-sm" /></label>
          <label className="grow text-xs">Message<input aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} className="mt-1 block w-full rounded bg-zinc-800 px-2 py-1 text-sm" /></label>
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} />Flagged</label>
          <button type="submit" className="rounded bg-zinc-700 px-3 py-1 text-sm hover:bg-zinc-600">Send</button>
        </form>
        <button type="button" data-testid="burst" disabled={busy} onClick={() => void burst()} className="mt-3 rounded bg-red-700 px-3 py-1.5 text-sm font-semibold hover:bg-red-600 disabled:opacity-50">
          Raid-bot burst ({BURST_SIZE} flagged messages)
        </button>
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
            <pre className="mt-1 overflow-x-auto font-mono text-xs"><span className="bg-red-800">{lines[error.line - 1] ?? ""}</span></pre>
          </div>
        )}
        <button type="button" data-testid="install" onClick={() => void install()} className="mt-2 rounded bg-sky-700 px-3 py-1.5 text-sm font-semibold hover:bg-sky-600">Install curse</button>
      </section>

      <section aria-labelledby="graph-h" className="rounded border border-zinc-800 p-3">
        <h2 id="graph-h" className="mb-2 font-semibold">Rule graph</h2>
        <RuleGraph graph={graph} />
      </section>

      <section aria-labelledby="owner-h" className="rounded border border-zinc-800 p-3">
        <h2 id="owner-h" className="mb-2 font-semibold">Owner inbox</h2>
        {(chat?.escalations.length ?? 0) === 0 ? (
          <p className="text-sm text-zinc-400">No escalations.</p>
        ) : (
          <ul data-testid="owner-inbox" className="space-y-1">
            {chat?.escalations.map((e) => (
              <li key={e.id} data-testid="escalation" className="rounded bg-amber-950 px-3 py-2 text-sm text-amber-100">
                <strong>Escalated to owner</strong> at {clock(e.at)}: {e.summary}
              </li>
            ))}
          </ul>
        )}
        <h2 className="mb-2 mt-4 font-semibold">Decision log</h2>
        {!latest ? (
          <p className="text-sm text-zinc-400">No decisions yet.</p>
        ) : (
          <div data-testid="decision-log" className="text-sm">
            <p>
              <span className="font-mono">{latest.curse}</span> on <span className="font-mono">{latest.eventId}</span>: <strong data-testid="decision-outcome">{latest.outcome}</strong>
            </p>
            <ul className="mt-1 space-y-0.5">
              {latest.conditions.map((c, i) => (
                <li key={i} className="font-mono text-xs">
                  {c.result ? "✔" : "✘"} {c.description}: observed {String(c.observed)}, expected {String(c.expected)}
                </li>
              ))}
              {latest.actions.map((a, i) => (
                <li key={`a${i}`} className="font-mono text-xs">{a.kind} {a.target}: {a.status} ({a.reason})</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}
