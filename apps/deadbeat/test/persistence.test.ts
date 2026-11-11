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
import { EXAMPLE_CURSE, LATE_PAYERS_FIRM_CURSE, LATE_PAYERS_ESCALATE_CURSE } from "@/lib/fixtures";
import { usePersistencePool } from "@/lib/runtime";
import type { SqlPool } from "@/lib/persistence";

const post = (url: string, body?: unknown) =>
  new Request(`http://test${url}`, { method: "POST", headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const undoReq = (id: string) => undo(post(`/api/grimoire/${id}/undo`), params(id));
const g = globalThis as Record<string, unknown>;

let pool: SqlPool;
/** Simulates a process restart: all in-memory host state is dropped and a new host binds to the same database. */
const restart = (p: SqlPool | null = pool) => {
  delete g["__deadbeatHost"];
  delete g["__deadbeatGraphs"];
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
  delete g["__deadbeatHost"];
  delete g["__deadbeatGraphs"];
});

describe("restart survival (pg-mem substitute)", () => {
  it("keeps the clock, invoices, outbox, escalations, sent tiers, curses and grimoire across a restart, and undo still works afterwards", async () => {
    for (const source of [EXAMPLE_CURSE, LATE_PAYERS_FIRM_CURSE, LATE_PAYERS_ESCALATE_CURSE]) await postCurse(post("/api/curses", { source }));
    await postEvent(post("/api/events", { days: 1 }));
    await postEvent(post("/api/events", { days: 30 }));
    const before = await (await getEvents()).json();
    const grimBefore = await (await getGrimoire()).json();
    expect(before.outbox.length).toBeGreaterThan(4);
    expect(before.escalations.length).toBeGreaterThan(0);

    restart();
    const after = await (await getEvents()).json();
    expect(after).toEqual(before);
    expect(after.curses).toEqual(["late-payers", "late-payers-firm", "late-payers-escalate"]);
    expect(await (await getGrimoire()).json()).toEqual(grimBefore);
    expect((await getGraph(new Request("http://test/x"), params("late-payers"))).status).toBe(200);

    // Sent tiers survived: re-running the same day after the restart sends nothing new.
    const again = await (await postEvent(post("/api/events", { days: 0 }))).json();
    expect(again.outbox).toHaveLength(before.outbox.length);
    expect((await (await getGrimoire()).json()).entries).toHaveLength(grimBefore.entries.length);

    // Undo after the restart marks the email retracted and appends a reversal.
    const email = grimBefore.entries.find((e: any) => e.kind === "email");
    const res = await undoReq(email.id);
    expect(res.status).toBe(200);
    expect((await res.json()).state.outbox.filter((o: any) => o.retracted)).toHaveLength(1);

    // The reversal survives another restart; double undo is refused; the undone tier is not re-sent.
    restart();
    const final = await (await getGrimoire()).json();
    expect(final.entries).toHaveLength(grimBefore.entries.length + 1);
    expect(final.entries.at(-1)).toMatchObject({ status: "reversed", reversalOf: email.id });
    expect((await undoReq(email.id)).status).toBe(409);
    const resent = await (await postEvent(post("/api/events", { days: 0 }))).json();
    expect(resent.outbox).toHaveLength(before.outbox.length);
  });

  it("applies the schema idempotently on every boot", async () => {
    await getEvents();
    restart();
    await getEvents();
    restart();
    await getEvents();
    const tables = (await rows("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).map((r) => r["table_name"]);
    expect(tables).toEqual(expect.arrayContaining(["deadbeat_state", "deadbeat_grimoire"]));
  });

  it("is append-only: undo adds a row and leaves earlier rows byte-identical; reset starts a new epoch without deleting", async () => {
    await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }));
    await postEvent(post("/api/events", { days: 1 }));
    const snapshot = async () => rows("SELECT epoch, seq, entry FROM deadbeat_grimoire ORDER BY epoch, seq");
    const first = await snapshot();
    expect(first).toHaveLength(4);

    const entries = (await (await getGrimoire()).json()).entries;
    await undoReq(entries[0].id);
    const second = await snapshot();
    expect(second).toHaveLength(5);
    expect(second.slice(0, 4)).toEqual(first);
    expect((second[4]!["entry"] as any).reversalOf).toBe(entries[0].id);

    await reset();
    expect((await snapshot()).slice(0, 5)).toEqual(second); // nothing deleted or updated
    restart();
    expect((await (await getGrimoire()).json()).entries).toEqual([]);
    const state = await (await getEvents()).json();
    expect(state.curses).toEqual([]);
    expect(state.outbox).toEqual([]);
    expect((await rows("SELECT epoch FROM deadbeat_state"))[0]!["epoch"]).toBe(2);
  });

  it("keeps the kill-switch override across a restart", async () => {
    await getEvents();
    const { getHost } = await import("@/lib/host");
    const { persistHost } = await import("@/lib/runtime");
    getHost().setEngineEnabled(false);
    await persistHost(getHost());
    restart();
    expect((await (await health()).json()).engineEnabled).toBe(false);
    expect((await postEvent(post("/api/events", { days: 1 }))).status).toBe(503);
  });
});

describe("boot resilience", () => {
  it("boots and serves /api/health with persistence down when DATABASE_URL is unreachable, without leaking the URL", async () => {
    process.env["DATABASE_URL"] = "postgres://user:s3cret@127.0.0.1:1/nodb";
    restart(null);
    const res = await health();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ ok: true, app: "deadbeat", persistence: { mode: "postgres", status: "down", error: "ECONNREFUSED" } });
    expect(text).not.toContain("s3cret");

    // The app keeps working from memory.
    expect((await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }))).status).toBe(201);
    expect((await (await postEvent(post("/api/events", { days: 1 }))).json()).outbox).toHaveLength(4);
    expect((await (await health()).json()).persistence.status).toBe("down");
  });

  it("reports degraded when a write fails, keeps serving, and catches up once the database returns", async () => {
    const real = pool;
    let broken = false;
    const gone = () => Promise.reject(Object.assign(new Error("gone"), { code: "ECONNRESET" }));
    const flaky: SqlPool = {
      query: (t, v) => (broken ? gone() : real.query(t, v)),
      connect: () => (broken ? gone() : real.connect()),
    };
    restart(flaky);
    await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }));
    expect((await (await health()).json()).persistence).toEqual({ mode: "postgres", status: "ok" });

    broken = true;
    await postEvent(post("/api/events", { days: 1 }));
    expect((await (await getEvents()).json()).outbox).toHaveLength(4);
    expect((await (await health()).json()).persistence).toEqual({ mode: "postgres", status: "degraded", error: "ECONNRESET" });

    broken = false;
    await postEvent(post("/api/events", { days: 0 }));
    expect((await (await health()).json()).persistence.status).toBe("ok");
    expect(await rows("SELECT seq FROM deadbeat_grimoire ORDER BY seq")).toHaveLength(4);
    restart(real);
    expect((await (await getEvents()).json()).outbox).toHaveLength(4);
  });
});
