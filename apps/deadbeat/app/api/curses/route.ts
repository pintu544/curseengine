import { tryParseCurse } from "@curseengine/engine";
import { curseToGraph } from "@/lib/graph";
import { curseStore, getHost } from "@/lib/host";
import { json, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

/** POST /api/curses {source} -> 201 {id, graph} | 422 {line, message} */
export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  if (!body || typeof body["source"] !== "string") {
    return json({ line: 1, message: 'Request body must be JSON with a string "source".' }, 422);
  }
  const result = tryParseCurse(body["source"]);
  if (!result.ok) return json({ line: result.error.line, message: result.error.message }, 422);
  const id = result.curse.name;
  curseStore().set(id, result.curse);
  getHost().install(result.curse);
  return json({ id, graph: curseToGraph(result.curse) }, 201);
}
