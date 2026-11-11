import { getHostReady } from "@/lib/runtime";
import { UNDO_NOTE, viewOf } from "@/lib/grimoire";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/grimoire: every audit entry in order, with derived reversed/reversible flags. */
export async function GET(): Promise<Response> {
  return json({ entries: viewOf((await getHostReady()).grimoire), note: UNDO_NOTE });
}
