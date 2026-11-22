"use client";

import { useCallback, useEffect, useState } from "react";
import type { DecisionRecord } from "@curseengine/engine";
import type { ChatSnapshot } from "@/lib/chat-state";
import { EXAMPLE_CURSE, RAID_BOT } from "@/lib/fixtures";
import type { RuleGraph as Graph } from "@/lib/graph";
import { Grimoire } from "./Grimoire";
import { RuleGraph } from "./RuleGraph";
import { Simulator } from "./Simulator";

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
    }).catch(() => undefined);
  }, []);

  const install = useCallback(async () => {
    try {
      const res = await fetch("/api/curses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source }) });
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

  const send = useCallback(async (m: { author: string; text: string; flagged: boolean }) => {
    const res = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(m) });
    const body = (await res.json()) as { chat?: ChatSnapshot; decisions?: DecisionRecord[] };
    if (body.chat) setChat(body.chat);
    if (body.decisions && body.decisions.length > 0) setLatest(body.decisions[body.decisions.length - 1] ?? null);
  }, []);

  const burst = useCallback(async () => {
    setBusy(true);
    try {
      for (let i = 1; i <= BURST_SIZE; i++) {
        await send({ author: RAID_BOT, text: `RAID ${i}/${BURST_SIZE}: join now http://spam.invalid/${i}`, flagged: true });
        if (i < BURST_SIZE) await sleep(BURST_GAP_MS);
      }
    } catch {
      // A network error ends the burst early; the finally block re-enables the button.
    } finally {
      setBusy(false);
    }
  }, [send]);

  const reset = useCallback(async () => {
    try {
      const d = (await (await fetch("/api/reset", { method: "POST" })).json()) as { chat: ChatSnapshot };
      setChat(d.chat);
      setLatest(null);
      setGraph(null);
    } catch {
      // Keep the current view if the server cannot be reached.
    }
  }, []);

  const lines = source.split("\n");
  const activeMutes = chat?.mutes ?? [];
  const mutedNow = new Set(activeMutes.filter((m) => m.until > Date.now()).map((m) => m.author));

  return (
    <main className="mx-auto grid max-w-7xl items-start gap-4 p-4 lg:grid-cols-2">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4 lg:col-span-2">
        <h1 className="page-title flex flex-wrap items-baseline gap-x-3">GrimMod <span className="tagline">chat moderation you can read</span></h1>
        <button type="button" onClick={() => void reset()} className="btn btn-secondary" title="Discards messages, decisions, the grimoire, active mutes and installed curses">Reset demo (discards all live state)</button>
      </header>

      <section aria-labelledby="chat-h" className="panel">
        <h2 id="chat-h" className="panel-title">Chat #general</h2>
        <div aria-live="polite">
          {[...mutedNow].map((a) => (
            <div key={a} data-testid="mute-banner" className="alert-red arrive mb-3 tabular-nums">
              {a} is muted until {clock(activeMutes.find((m) => m.author === a)?.until ?? 0)} (1 day by the curse).
            </div>
          ))}
        </div>
        <ul data-testid="chat-list" aria-label="Chat messages" aria-live="polite" tabIndex={0} className="scroll-thin max-h-96 space-y-2 overflow-y-auto pr-1">
          {(chat?.messages ?? []).map((m) => (
            <li
              key={m.id}
              data-testid="chat-message"
              data-author={m.author}
              data-flagged={m.flagged}
              data-muted={m.muted}
              className={`rounded-lg border px-3 py-2 text-sm ${m.system ? "border-zinc-800 bg-zinc-950 italic text-zinc-300" : "border-zinc-800 bg-zinc-950"} ${m.muted ? "opacity-80 line-through" : ""}`}
            >
              <span className="font-semibold text-zinc-100">{m.author}</span>
              {m.flagged && <span className="pill pill-amber ml-2 align-middle">flagged</span>}
              {m.muted && <span className="pill pill-red ml-2 align-middle no-underline">muted</span>}
              {mutedNow.has(m.author) && !m.muted && <span className="pill pill-red ml-2 align-middle">author muted</span>}
              <span className="ml-2 text-xs tabular-nums text-zinc-400">{clock(m.at)}</span>
              <div className="mt-0.5 text-zinc-200">{m.text}</div>
            </li>
          ))}
        </ul>
        <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { void send({ author, text, flagged }).catch(() => undefined); setText(""); } }}>
          <label className="field-label">Author<input aria-label="Author" value={author} onChange={(e) => setAuthor(e.target.value)} className="field mt-1 w-24" /></label>
          <label className="field-label min-w-40 grow basis-48">Message<input aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} className="field mt-1 w-full" /></label>
          <label className="field-label flex h-8 items-center gap-1.5"><input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} className="accent-violet-500" />Flagged</label>
          <button type="submit" className="btn btn-secondary">Send</button>
        </form>
        <button type="button" data-testid="burst" disabled={busy} onClick={() => void burst()} className="btn btn-danger mt-4">
          Raid-bot burst ({BURST_SIZE} flagged messages)
        </button>
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

      <section aria-labelledby="owner-h" className="panel">
        <h2 id="owner-h" className="panel-title">Owner inbox</h2>
        <div aria-live="polite">
          {(chat?.escalations.length ?? 0) === 0 ? (
            <p className="empty-state">No escalations.</p>
          ) : (
            <ul data-testid="owner-inbox" className="space-y-2">
              {chat?.escalations.map((e) => (
                <li key={e.id} data-testid="escalation" className="card-amber arrive tabular-nums">
                  <strong className="font-semibold">Escalated to owner</strong> at {clock(e.at)}: {e.summary}
                </li>
              ))}
            </ul>
          )}
        </div>
        <h2 className="panel-title mt-5">Decision log</h2>
        <div aria-live="polite">
        {!latest ? (
          <p className="empty-state">No decisions yet.</p>
        ) : (
          <div data-testid="decision-log" className="arrive rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm">
            <p>
              <span className="font-mono">{latest.curse}</span> on <span className="font-mono">{latest.eventId}</span>: <strong data-testid="decision-outcome" className="font-semibold">{latest.outcome}</strong>
            </p>
            <ul className="mt-2 space-y-1">
              {latest.conditions.map((c, i) => (
                <li key={i} className="font-mono text-xs text-zinc-300">
                  {c.result ? "✔" : "✘"} {c.description}: observed {String(c.observed)}, expected {String(c.expected)}
                </li>
              ))}
              {latest.actions.map((a, i) => (
                <li key={`a${i}`} className="font-mono text-xs text-zinc-300">{a.kind} {a.target}: {a.status} ({a.reason})</li>
              ))}
            </ul>
          </div>
        )}
        </div>
      </section>

      <Simulator curseId={graph?.name ?? "spam-strikes"} />
      <Grimoire
        version={`${chat?.messages.length ?? 0}-${chat?.mutes.length ?? 0}-${chat?.escalations.length ?? 0}`}
        onUndone={() => void fetch("/api/events").then((r) => r.json()).then((d: { chat: ChatSnapshot }) => setChat(d.chat)).catch(() => undefined)}
      />
    </main>
  );
}
