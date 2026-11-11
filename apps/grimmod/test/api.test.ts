import { beforeEach, describe, expect, it } from "vitest";
import { POST as postCurse } from "../app/api/curses/route";
import { GET as getGraph } from "../app/api/curses/[id]/graph/route";
import { GET as getEvents, POST as postEvent } from "../app/api/events/route";
import { GET as health } from "../app/api/health/route";
import { POST as reset } from "../app/api/reset/route";
import { EXAMPLE_CURSE } from "@/lib/fixtures";

const post = (url: string, body: unknown) =>
  new Request(`http://test${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(async () => {
  await reset();
});

describe("POST /api/curses", () => {
  it("returns 201 {id, graph} for a valid curse", async () => {
    const res = await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("spam-strikes");
    expect(body.graph.nodes).toHaveLength(4);
  });

  it("returns 422 {line, message} with the exact line for invalid source", async () => {
    const res = await postCurse(post("/api/curses", { source: "curse bad:\n  when message\n  -> explode owner" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.line).toBe(3);
    expect(body.message).toMatch(/expected an action.*"explode"/);
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
  });

  it("returns 422 when source is missing", async () => {
    expect((await postCurse(post("/api/curses", {}))).status).toBe(422);
  });
});

describe("GET /api/curses/:id/graph", () => {
  it("returns the stored graph, or 404", async () => {
    await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }));
    const ok = await getGraph(new Request("http://test/x"), { params: Promise.resolve({ id: "spam-strikes" }) });
    expect(ok.status).toBe(200);
    expect((await ok.json()).graph.name).toBe("spam-strikes");
    const missing = await getGraph(new Request("http://test/x"), { params: Promise.resolve({ id: "nope" }) });
    expect(missing.status).toBe(404);
  });
});

describe("POST /api/events", () => {
  it("mutes the raid-bot on the third flagged event and escalates", async () => {
    await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }));
    const outcomes: string[] = [];
    let last: any;
    for (let i = 0; i < 3; i++) {
      last = await (await postEvent(post("/api/events", { author: "raid-bot", text: `spam ${i}`, flagged: true }))).json();
      outcomes.push(last.decisions[0].outcome);
    }
    expect(outcomes).toEqual(["no-match", "no-match", "executed"]);
    expect(last.chat.mutes[0].author).toBe("raid-bot");
    expect(last.chat.escalations).toHaveLength(1);
    const state = await (await getEvents()).json();
    expect(state.chat.escalations).toHaveLength(1);
  });

  it("rejects malformed events with 400", async () => {
    expect((await postEvent(post("/api/events", { author: "x" }))).status).toBe(400);
  });
});

describe("GET /api/health", () => {
  it("is ok", async () => {
    expect(await (await health()).json()).toEqual({ ok: true, app: "grimmod" });
  });
});
