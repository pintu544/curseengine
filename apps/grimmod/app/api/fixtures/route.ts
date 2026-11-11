import { DESIGNED_SPAMMERS } from "@/lib/fixtures";
import { refreshFixtures } from "@/lib/host";
import { getHostReady, persistHost } from "@/lib/runtime";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/fixtures: idempotent load/refresh of the fixture set (reference clock, stable ids, example curse installed).
 * This is a FULL DEMO RESET: live state (grimoire, decisions, suppressed list, mutes, user curses) is discarded,
 * and the response says so with `reset: true`.
 */
export async function POST(): Promise<Response> {
  await getHostReady();
  const host = refreshFixtures();
  await persistHost(host, { rotate: true });
  return json({ reset: true, messages: host.chat.messages.length, curses: host.getCurses().map((c) => c.name), designedSpammers: DESIGNED_SPAMMERS, chat: host.chat.snapshot() });
}
