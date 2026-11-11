import { getHost } from "@/lib/host";
import { MUTED_NOTE, viewOf } from "@/lib/grimoire";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/grimoire: every audit entry in order, plus the messages suppressed while their author was muted. */
export async function GET(): Promise<Response> {
  const host = getHost();
  return json({ entries: viewOf(host.grimoire), suppressedWhileMuted: host.suppressed, note: MUTED_NOTE });
}
