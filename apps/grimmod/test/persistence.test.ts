/**
 * Postgres persistence tests. NO real Postgres is used: the database is pg-mem, an in-process PostgreSQL emulator
 * (a test substitute) driven through the same pg Pool interface the app uses in production. Passing here shows the
 * SQL and the restart logic work against that emulator; it is not proof of behaviour on a real Postgres server.
 */
import { newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getGrimoire } from "../app/api/grimoire/route";
import { POST as undo } from "../app/api/grimoire/[id]/undo/route";
import { POST as postCurse } from "../app/api/curses/route";
import { GET as getGraph } from "../app/api/curses/[id]/graph/route";
import { GET as getEvents, POST as postEvent } from "../app/api/events/route";
import { GET as health } from "../app/api/health/route";
import { POST as reset } from "../app/api/reset/route";
import { EXAMPLE_CURSE } from "@/lib/fixtures";
import { usePersistencePool } from "@/lib/runtime";
import type { SqlPool } from "@/lib/persistence";

const post = (url: string, body: unknown) =>
  new Request(`http://test${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const undoReq = (id: string) => undo(post(`/api/grimoire/${id}/undo`, {}), { params: Promise.resolve({ id }) });
const burst = async (n: number, author = "raid-bot") => {
  for (let i = 0; i < n; i++) await postEvent(post("/api/events", { author, text: `spam ${i}`, flagged: true }));
};
const g = globalThis as Record<string, unknown>;

let pool: SqlPool;
/** Simulates a process restart: all in-memory host state is dropped and a new host binds to the same database. */
const restart = (p: SqlPool | null = pool) => {
  delete g["__grimmodHost"];
  delete g["__grimmodGraphs"];
  usePersistencePool(p);
};
const freshPool = (): SqlPool => {
  // pg-mem's AST coverage check flags the column constraints of a CREATE TABLE IF NOT EXISTS that is a no-op on re-run,
  // which real Postgres accepts. It is switched off here so the idempotent re-run can be exercised at all.
  const { Pool } = newDb({ noAstCoverageCheck: true }).adapters.createPg();
  return new Pool() as unknown as SqlPool;
};
const rows = async (sql: string) => (await pool.query(sql)).rows;
const savedUrl = process.env["DATABASE_URL"];

beforeEach(() => {
  delete process.env["DATABASE_URL"];
  pool = freshPool();
  restart();
});
afterEach(() => {
  if (savedUrl === undefined) delete process.env["DATABASE_URL"];
  else process.env["DATABASE_URL"] = savedUrl;
  usePersistencePool(null);
  delete g["__grimmodHost"];
  delete g["__grimmodGraphs"];
});

describe("restart survival (pg-mem substitute)", () => {
  it("keeps chat state, curses, decisions, suppressed list and grimoire across a restart, and undo still works afterwards", async () => {
    await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }));
    await burst(3); // third flagged message mutes raid-bot and escalates
    await postEvent(post("/api/events", { author: "raid-bot", text: "muted now" })); // suppressed while muted
    const before = await (await getEvents()).json();
    const grimBefore = await (await getGrimoire()).json();
    expect(before.chat.mutes).toHaveLength(1);
    expect(grimBefore.entries.map((e: any) => e.kind)).toEqual(["mute", "escalate"]);
    expect(grimBefore.suppressedTotal).toBe(1);

    restart();
    const after = await (await getEvents()).json();
    expect(after.chat).toEqual(before.chat);
    expect(after.curses).toEqual(["spam-strikes"]);
    expect(after.latest).toEqual(before.latest);
    const grimAfter = await (await getGrimoire()).json();
    expect(grimAfter).toEqual(grimBefore);
    expect((await getGraph(new Request("http://test/x"), { params: Promise.resolve({ id: "spam-strikes" }) })).status).toBe(200);

    // Undo after the restart: lifts the mute and appends a reversal.
    const mute = grimAfter.entries.find((e: any) => e.kind === "mute");
    const res = await undoReq(mute.id);
    expect(res.status).toBe(200);
    expect((await res.json()).chat.mutes).toEqual([]);

    // The reversal itself survives a second restart, and double undo is still refused.
    restart();
    const final = await (await getGrimoire()).json();
    expect(final.entries.map((e: any) => e.status)).toEqual(["applied", "applied", "reversed"]);
    expect(final.entries[2].reversalOf).toBe(mute.id);
    expect((await undoReq(mute.id)).status).toBe(409);
    expect((await (await getEvents()).json()).chat.mutes).toEqual([]);
    const free = await (await postEvent(post("/api/events", { author: "raid-bot", text: "back again" }))).json();
    expect(free.message.muted).toBe(false);
  });

  it("applies the schema idempotently on every boot", async () => {
    await getEvents();
    restart();
    await getEvents();
    restart();
    await getEvents();
    const tables = (await rows("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).map((r) => r["table_name"]);
    expect(tables).toEqual(expect.arrayContaining(["grimmod_state", "grimmod_grimoire"]));
  });

  it("is append-only: undo adds a row and leaves earlier rows byte-identical; reset starts a new epoch without deleting", async () => {
    await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }));
    await burst(3);
    const snapshot = async () => rows("SELECT epoch, seq, entry FROM grimmod_grimoire ORDER BY epoch, seq");
    const first = await snapshot();
    expect(first).toHaveLength(2);

    const entries = (await (await getGrimoire()).json()).entries;
    await undoReq(entries[0].id);
    const second = await snapshot();
    expect(second).toHaveLength(3);
    expect(second.slice(0, 2)).toEqual(first);
    expect((second[2]!["entry"] as any).reversalOf).toBe(entries[0].id);

    await reset();
    const third = await snapshot();
    expect(third.slice(0, 3)).toEqual(second); // nothing deleted or updated
    expect(await (await getGrimoire()).json()).toMatchObject({ entries: [] });
    restart();
    expect((await (await getGrimoire()).json()).entries).toEqual([]);
    expect((await (await getEvents()).json()).curses).toEqual([]);
    expect((await rows("SELECT epoch FROM grimmod_state"))[0]!["epoch"]).toBe(2);
  });

  it("keeps the kill-switch override across a restart and a reset", async () => {
    await getEvents();
    const { getHost } = await import("@/lib/host");
    const { persistHost } = await import("@/lib/runtime");
    getHost().setEngineEnabled(false);
    await persistHost(getHost());
    restart();
    expect((await (await health()).json()).engineEnabled).toBe(false);
    expect((await postEvent(post("/api/events", { author: "a", text: "b" }))).status).toBe(503);
  });
});

describe("boot resilience", () => {
  it("boots and serves /api/health with persistence down when DATABASE_URL is unreachable, without leaking the URL", async () => {
    process.env["DATABASE_URL"] = "postgres://user:s3cret@127.0.0.1:1/nodb";
    restart(null);
    const res = await health();
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body).toMatchObject({ ok: true, app: "grimmod", persistence: { mode: "postgres", status: "down", error: "ECONNREFUSED" } });
    expect(text).not.toContain("s3cret");

    // The app keeps working from memory.
    expect((await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }))).status).toBe(201);
    await burst(3);
    expect((await (await getEvents()).json()).chat.mutes).toHaveLength(1);
    expect((await (await health()).json()).persistence.status).toBe("down");
  });

  it("reports degraded when a write fails, keeps serving, and catches up once the database returns", async () => {
    const real = pool;
    let broken = false;
    const flaky: SqlPool = {
      query: (t, v) => (broken ? Promise.reject(Object.assign(new Error("gone"), { code: "ECONNRESET" })) : real.query(t, v)),
      connect: () => (broken ? Promise.reject(Object.assign(new Error("gone"), { code: "ECONNRESET" })) : real.connect()),
    };
    restart(flaky);
    await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }));
    expect((await (await health()).json()).persistence).toEqual({ mode: "postgres", status: "ok" });

    broken = true;
    await burst(3);
    expect((await (await getEvents()).json()).chat.mutes).toHaveLength(1);
    expect((await (await health()).json()).persistence).toEqual({ mode: "postgres", status: "degraded", error: "ECONNRESET" });

    broken = false;
    await postEvent(post("/api/events", { author: "someone", text: "hello" }));
    expect((await (await health()).json()).persistence.status).toBe("ok");
    expect(await rows("SELECT seq FROM grimmod_grimoire ORDER BY seq")).toHaveLength(2);
    restart(real);
    expect((await (await getEvents()).json()).chat.mutes).toHaveLength(1);
  });
});
