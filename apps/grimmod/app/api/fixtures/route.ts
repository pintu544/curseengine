import { DESIGNED_SPAMMERS } from "@/lib/fixtures";
import { refreshFixtures } from "@/lib/host";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** POST /api/fixtures: idempotent load/refresh of the fixture set (reference clock, stable ids, example curse installed). */
export async function POST(): Promise<Response> {
  const host = refreshFixtures();
  return json({ messages: host.chat.messages.length, curses: host.getCurses().map((c) => c.name), designedSpammers: DESIGNED_SPAMMERS, chat: host.chat.snapshot() });
}
