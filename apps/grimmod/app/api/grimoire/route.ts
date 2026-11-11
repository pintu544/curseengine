import { getHostReady } from "@/lib/runtime";
import { MUTED_NOTE, viewOf } from "@/lib/grimoire";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Most recent suppressed-while-muted entries returned; the host keeps its full record, the payload does not. */
const SUPPRESSED_LIMIT = 50;

/**
 * GET /api/grimoire: every audit entry in order, plus the exact count of messages suppressed while their author
 * was muted and only the most recent SUPPRESSED_LIMIT of them (`suppressedTruncated` says whether any were dropped).
 */
export async function GET(): Promise<Response> {
  const host = await getHostReady();
  const total = host.suppressed.length;
  return json({
    entries: viewOf(host.grimoire),
    suppressedTotal: total,
    suppressed: host.suppressed.slice(-SUPPRESSED_LIMIT),
    suppressedTruncated: total > SUPPRESSED_LIMIT,
    note: MUTED_NOTE,
  });
}
