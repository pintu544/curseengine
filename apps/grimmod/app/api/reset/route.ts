import { resetHost } from "@/lib/host";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** POST /api/reset: demo convenience. Restores fixtures and removes installed curses. */
export async function POST(): Promise<Response> {
  const host = resetHost();
  return json({ chat: host.chat.snapshot() });
}
