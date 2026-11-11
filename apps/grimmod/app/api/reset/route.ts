import { resetHost } from "@/lib/host";
import { json } from "@/lib/http";
import { getHostReady, persistHost } from "@/lib/runtime";

export const dynamic = "force-dynamic";

/** POST /api/reset: demo convenience. Restores fixtures and removes installed curses. */
export async function POST(): Promise<Response> {
  await getHostReady();
  const host = resetHost();
  await persistHost(host, { rotate: true });
  return json({ chat: host.chat.snapshot() });
}
