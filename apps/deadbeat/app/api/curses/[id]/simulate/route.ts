import { simulate } from "@curseengine/engine";
import { REFERENCE_NOW, simulationInvoices } from "@/lib/fixtures";
import { curseStore, DEMO_QUOTA_PER_HOUR, getHost, toTickEvent } from "@/lib/host";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/curses/:id/simulate: runs the installed curse over the fixture history (one tick per fixture invoice at
 * the reference clock) with a recording stub. Touches no outbox, no invoice state, no grimoire and no adapter.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const curse = curseStore().get(id);
  if (!curse) return json({ message: `No curse named "${id}" is installed.` }, 404);
  const events = simulationInvoices().map((inv) => toTickEvent(inv, `sim-tick-${inv.id}`, REFERENCE_NOW));
  // Declared set is derived from the mail adapter, so it cannot drift from what the host can actually run.
  const report = await simulate({ curses: [curse], events, quotaPerHour: DEMO_QUOTA_PER_HOUR, declared: getHost().declaredCapabilities() });
  return json({ curse: id, history: "fixture", summaryLine: `${report.summary.byKind.email.taken} emailed, ${report.summary.byKind.escalate.taken} escalated`, report });
}
