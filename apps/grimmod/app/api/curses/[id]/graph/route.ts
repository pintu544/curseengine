import { curseToGraph } from "@/lib/graph";
import { curseStore } from "@/lib/host";
import { json } from "@/lib/http";
import { getHostReady } from "@/lib/runtime";

export const dynamic = "force-dynamic";

/** GET /api/curses/:id/graph */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  await getHostReady();
  const curse = curseStore().get(id);
  if (!curse) return json({ message: `No curse named "${id}" is installed.` }, 404);
  return json({ id, graph: curseToGraph(curse) });
}
