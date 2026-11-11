import { AlreadyReversedError, NotReversibleError, UnknownEntryError } from "@curseengine/engine";
import { getHostReady, persistHost } from "@/lib/runtime";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** POST /api/grimoire/:id/undo: 200 {reversal, chat} | 404 unknown entry | 409 already reversed or not reversible. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const host = await getHostReady();
  try {
    const reversal = host.undo(id);
    await persistHost(host);
    return json({ reversal, chat: host.chat.snapshot() });
  } catch (err) {
    if (err instanceof UnknownEntryError) return json({ message: err.message }, 404);
    if (err instanceof AlreadyReversedError || err instanceof NotReversibleError) return json({ message: err.message }, 409);
    // The effect is already gone (for example the mute was lifted another way): nothing was appended.
    if (err instanceof Error) return json({ message: err.message }, 409);
    throw err;
  }
}
