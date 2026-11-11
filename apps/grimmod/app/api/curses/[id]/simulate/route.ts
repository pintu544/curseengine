import { simulate, summaryLine, type EngineEvent } from "@curseengine/engine";
import { DEFAULT_CHANNEL, DESIGNED_SPAMMERS, simulationHistory } from "@/lib/fixtures";
import { curseStore, DEMO_QUOTA_PER_HOUR, getHost, toEngineEvent } from "@/lib/host";
import { json, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Parses the optional `events` list: [{id?, author, text, at, flagged?, channel?}]. Returns an error string on bad input. */
function parseEvents(raw: unknown): EngineEvent[] | string {
  if (!Array.isArray(raw)) return '"events" must be an array.';
  if (raw.length > 5000) return '"events" may hold at most 5000 events.';
  const out: EngineEvent[] = [];
  for (const [i, e] of raw.entries()) {
    const r = e && typeof e === "object" ? (e as Record<string, unknown>) : undefined;
    if (!r || typeof r["author"] !== "string" || typeof r["text"] !== "string" || typeof r["at"] !== "number" || !Number.isFinite(r["at"])) {
      return `events[${i}] must have string "author" and "text" and a numeric "at".`;
    }
    out.push(toEngineEvent({
      id: typeof r["id"] === "string" && r["id"] ? r["id"] : `sim-evt-${i + 1}`,
      author: r["author"], text: r["text"], at: r["at"], flagged: r["flagged"] === true,
      channel: typeof r["channel"] === "string" && r["channel"] ? r["channel"] : DEFAULT_CHANNEL,
    }));
  }
  return out;
}

/**
 * POST /api/curses/:id/simulate {events?}: runs the installed curse over the supplied events (default: the
 * designed simulation history) with a recording stub. Touches no chat state, no grimoire, no adapter.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const curse = curseStore().get(id);
  if (!curse) return json({ message: `No curse named "${id}" is installed.` }, 404);
  const body = await readJson(req);
  const custom = body !== undefined && body["events"] !== undefined;
  let events: EngineEvent[];
  if (custom) {
    const parsed = parseEvents(body!["events"]);
    if (typeof parsed === "string") return json({ message: parsed }, 400);
    events = parsed;
  } else {
    events = simulationHistory().map(toEngineEvent);
  }
  // Declared set mirrors the chat adapter (no email). A curse needing an undeclared capability (e.g. email) runs in
  // its own shadow executor and is refused at preflight: no quota consumed, identical refusal per event (see
  // "Refused curses" in the design spec). The report is built from a recording stub only.
  const report = await simulate({ curses: [curse], events, quotaPerHour: DEMO_QUOTA_PER_HOUR, declared: getHost().declaredCapabilities() });
  const expected = custom ? undefined : DESIGNED_SPAMMERS;
  const falsePositives = expected ? report.summary.mutedTargets.filter((t) => !expected.includes(t)) : undefined;
  return json({
    curse: id,
    history: custom ? "custom" : "fixture",
    summaryLine: summaryLine(report, expected),
    falsePositives: falsePositives ?? null,
    report,
  });
}
