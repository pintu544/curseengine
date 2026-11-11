import { resetHost } from "@/lib/host";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/reset: demo convenience. Restores the fixture invoices at the reference clock and removes installed
 * curses, the outbox, escalations, the grimoire, decisions and sent-tier tracking. The response says so.
 */
export async function POST(): Promise<Response> {
  const host = resetHost();
  return json({
    reset: true,
    note: "Restored the fixture invoices at the reference clock. Removed all installed curses and discarded the outbox, escalations, grimoire, decisions and sent-tier tracking.",
    state: host.state.snapshot(),
  });
}
