import { DEFAULT_CHANNEL } from "@/lib/fixtures";
import { EngineDisabledError } from "@/lib/host";
import { getHostReady, persistHost } from "@/lib/runtime";
import { json, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

let counter = 0;

/** GET /api/events: current chat state (messages, mutes, escalations) and the latest decision. */
export async function GET(): Promise<Response> {
  const host = await getHostReady();
  return json({ chat: host.chat.snapshot(), curses: host.getCurses().map((c) => c.name), latest: host.decisions.at(-1) ?? null });
}

/**
 * POST /api/events {author, text, flagged?, channel?}: a chat message arrives, becomes an
 * engine event and is fed to the executor. Returns the decision records and the chat state.
 * A curse whose action fails shows up as a "failed" decision record; the response is still 200.
 */
export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  const author = body?.["author"];
  const text = body?.["text"];
  if (typeof author !== "string" || !author.trim() || typeof text !== "string" || !text.trim()) {
    return json({ message: 'Body must include non-empty string "author" and "text".' }, 400);
  }
  const host = await getHostReady();
  if (!host.engineEnabled) return json({ disabled: true, killSwitch: "CURSE_ENGINE_ENABLED", message: new EngineDisabledError().message }, 503);
  const last = host.chat.messages.at(-1)?.at ?? 0;
  counter += 1;
  const msg = {
    id: `live-${Date.now()}-${counter}`,
    author: author.trim(),
    channel: typeof body?.["channel"] === "string" && body["channel"] ? body["channel"] : DEFAULT_CHANNEL,
    text: text.trim(),
    at: Math.max(Date.now(), last + 1),
    flagged: body?.["flagged"] === true,
  };
  try {
    const result = await host.receive(msg);
    await persistHost(host);
    return json(result);
  } catch (err) {
    if (err instanceof EngineDisabledError) return json({ disabled: true, killSwitch: "CURSE_ENGINE_ENABLED", message: err.message }, 503);
    throw err;
  }
}
