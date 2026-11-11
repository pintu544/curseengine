import { refreshFixtures } from "@/lib/host";
import { json } from "@/lib/http";
import { getHostReady, persistHost } from "@/lib/runtime";

export const dynamic = "force-dynamic";

/**
 * POST /api/fixtures: idempotent load/refresh of the fixture set (reference clock, stable ids, tier curses installed).
 * This is a FULL DEMO RESET: live state (outbox, escalations, grimoire, decisions, sent tiers, user curses) is discarded,
 * and the response says so with `reset: true`.
 */
export async function POST(): Promise<Response> {
  await getHostReady();
  const host = refreshFixtures();
  await persistHost(host, { rotate: true });
  return json({ reset: true, invoices: host.state.invoices.length, curses: host.getCurses().map((c) => c.name), state: host.state.snapshot() });
}
