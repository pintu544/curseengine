import { EngineDisabledError, getHost, MAX_ADVANCE_DAYS } from "@/lib/host";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** FR9 kill switch response: 503, nothing processed. */
function disabled(): Response {
  return json({ disabled: true, killSwitch: "CURSE_ENGINE_ENABLED", message: new EngineDisabledError().message }, 503);
}

/** GET /api/events: invoices, the clock, the outbox, escalations and the latest decision. */
export async function GET(): Promise<Response> {
  const host = getHost();
  return json({ ...host.state.snapshot(), curses: host.getCurses().map((c) => c.name), latest: host.decisions.at(-1) ?? null });
}

/**
 * POST /api/events {days?}: advances the fixture clock by `days` whole days (default 1, forward only; 0 re-runs the
 * current day without duplicating anything). Emits one tick per invoice per day. 400 on bad input.
 */
export async function POST(req: Request): Promise<Response> {
  if (!getHost().engineEnabled) return disabled();
  const text = await req.text();
  let days = 1;
  if (text.trim() !== "") {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return json({ message: "Body must be JSON." }, 400); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ message: 'Body must be a JSON object such as {"days": 1}.' }, 400);
    const d = (parsed as Record<string, unknown>)["days"];
    if (d !== undefined) {
      if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > MAX_ADVANCE_DAYS) return json({ message: `"days" must be a whole number from 0 to ${MAX_ADVANCE_DAYS}.` }, 400);
      days = d;
    }
  }
  try {
    return json(await getHost().advanceClock(days));
  } catch (err) {
    if (err instanceof EngineDisabledError) return disabled();
    throw err;
  }
}
