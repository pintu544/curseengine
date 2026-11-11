import { json } from "@/lib/http";
import { getHostReady, persistenceHealth } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const host = await getHostReady();
  // `persistence` appears only when DATABASE_URL is set. Health stays 200 when the database is down so the app is not restarted in a loop.
  const persistence = persistenceHealth();
  return json({ ok: true, app: "grimmod", engineEnabled: host.engineEnabled, ...(persistence ? { persistence } : {}) });
}
