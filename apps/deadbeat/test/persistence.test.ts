/**
 * Postgres persistence tests. NO real Postgres is used: the database is pg-mem, an in-process PostgreSQL emulator
 * (a test substitute) driven through the same pg Pool interface the app uses in production. Passing here shows the
 * SQL and the restart logic work against that emulator; it is not proof of behaviour on a real Postgres server.
 */
import { DataType, newDb } from "pg-mem";
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
import { LATEST_SCHEMA_VERSION, MIGRATIONS, migrate, type SqlPool } from "@/lib/persistence";

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
  const db = newDb({ noAstCoverageCheck: true });
  // pg-mem has no advisory locks. These shims let the migration's lock statement run; they cannot
  // reproduce real lock contention, so the serialisation itself is covered by review of the SQL, not by this suite.
  db.public.registerFunction({ name: "hashtext", args: [DataType.text], returns: DataType.integer, implementation: (t: string) => t.length });
  db.public.registerFunction({ name: "pg_advisory_xact_lock", args: [DataType.integer], returns: DataType.bool, implementation: () => true });
  const { Pool } = db.adapters.createPg();
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
    expect(JSON.parse(text)).toMatchObject({ ok: true, app: "deadbeat", persistence: { mode: "postgres", status: "down", schemaVersion: null, error: "ECONNREFUSED" } });
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
    expect((await (await health()).json()).persistence).toEqual({ mode: "postgres", status: "ok", schemaVersion: LATEST_SCHEMA_VERSION });

    broken = true;
    await postEvent(post("/api/events", { days: 1 }));
    expect((await (await getEvents()).json()).outbox).toHaveLength(4);
    expect((await (await health()).json()).persistence).toEqual({ mode: "postgres", status: "degraded", schemaVersion: LATEST_SCHEMA_VERSION, error: "ECONNRESET" });

    broken = false;
    await postEvent(post("/api/events", { days: 0 }));
    expect((await (await health()).json()).persistence.status).toBe("ok");
    expect(await rows("SELECT seq FROM deadbeat_grimoire ORDER BY seq")).toHaveLength(4);
    restart(real);
    expect((await (await getEvents()).json()).outbox).toHaveLength(4);
  });
});

const APP_NAME = "deadbeat";
const versionRows = async () => rows(`SELECT name, value, updated_at FROM ${APP_NAME}_meta`);
const userTables = async () =>
  (await rows("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).map((r) => String(r["table_name"])).sort();

describe("schema versioning (pg-mem substitute)", () => {
  it("v1 is the current schema and the latest version is derived from the migration list", () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1]);
    expect(LATEST_SCHEMA_VERSION).toBe(1);
  });

  it("a fresh database converges on v1: all tables exist and the meta row says 1; health reports it", async () => {
    const body = await (await health()).json();
    expect(body.persistence).toEqual({ mode: "postgres", status: "ok", schemaVersion: 1 });
    expect(await userTables()).toEqual([`${APP_NAME}_grimoire`, `${APP_NAME}_meta`, `${APP_NAME}_state`]);
    const meta = await versionRows();
    expect(meta).toHaveLength(1);
    expect(meta[0]).toMatchObject({ name: "schema_version", value: "1" });
  });

  it("migrate() is idempotent: running it again returns the same version and changes nothing", async () => {
    expect(await migrate(pool)).toBe(1);
    const first = await versionRows();
    expect(await migrate(pool)).toBe(1);
    expect(await migrate(pool)).toBe(1);
    expect(await versionRows()).toEqual(first); // same row, same updated_at: not even rewritten
    expect(await userTables()).toHaveLength(3);
  });

  it("repeated app boots keep one meta row at v1 and keep serving", async () => {
    for (let i = 0; i < 3; i++) {
      restart();
      expect((await (await health()).json()).persistence.schemaVersion).toBe(1);
    }
    expect(await versionRows()).toHaveLength(1);
  });

  it("runs inside one transaction that takes the per-app advisory lock first, then commits", async () => {
    const seen: string[] = [];
    const real = pool;
    const spy: SqlPool = {
      query: (t, v) => real.query(t, v),
      connect: async () => {
        const conn = await real.connect();
        return { query: (t: string, v?: unknown[]) => { seen.push(t.trim().replace(/\s+/g, " ")); return conn.query(t, v); }, release: (e?: unknown) => conn.release(e) };
      },
    };
    expect(await migrate(spy)).toBe(1);
    expect(seen[0]).toBe("BEGIN");
    expect(seen[1]).toBe(`SELECT pg_advisory_xact_lock(hashtext('${APP_NAME}_schema'))`);
    expect(seen[seen.length - 1]).toBe("COMMIT");
    expect(seen.filter((q) => q === "BEGIN" || q === "COMMIT")).toEqual(["BEGIN", "COMMIT"]);
    // A second run takes the lock again and applies nothing: BEGIN, lock, meta DDL, read version, COMMIT.
    seen.length = 0;
    expect(await migrate(spy)).toBe(1);
    expect(seen).toHaveLength(5);
    expect(seen.some((q) => q.startsWith("INSERT"))).toBe(false);
  });

  it("adopts a database that predates versioning as v1 without touching its rows", async () => {
    // Build the pre-versioning world: the v1 tables with data and NO meta table.
    for (const sql of MIGRATIONS[0]!.statements) await pool.query(sql);
    await pool.query(`INSERT INTO ${APP_NAME}_state (id, epoch, snapshot) VALUES ('other', 7, '{"keep":"me"}'::jsonb)`);
    await pool.query(`INSERT INTO ${APP_NAME}_grimoire (epoch, seq, entry) VALUES (7, 1, '{"legacy":true}'::jsonb)`);
    expect(await userTables()).not.toContain(`${APP_NAME}_meta`);
    const stateBefore = await rows(`SELECT id, epoch, snapshot FROM ${APP_NAME}_state`);
    const grimBefore = await rows(`SELECT epoch, seq, entry FROM ${APP_NAME}_grimoire`);

    expect(await migrate(pool)).toBe(1);

    expect((await versionRows())[0]).toMatchObject({ name: "schema_version", value: "1" });
    expect(await rows(`SELECT id, epoch, snapshot FROM ${APP_NAME}_state`)).toEqual(stateBefore);
    expect(await rows(`SELECT epoch, seq, entry FROM ${APP_NAME}_grimoire`)).toEqual(grimBefore);
  });

  it("a booted app whose version row is missing (an unversioned database) comes back at v1 with its state intact", async () => {
    await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }));
    const before = await (await getEvents()).json();
    await pool.query(`DELETE FROM ${APP_NAME}_meta`); // pg-mem cannot re-create a dropped table; an empty meta is the same "no version recorded" state
    restart();
    const body = await (await health()).json();
    expect(body.persistence).toEqual({ mode: "postgres", status: "ok", schemaVersion: 1 });
    expect((await (await getEvents()).json()).curses).toEqual(before.curses);
  });

  it("refuses a database written by a NEWER build: SCHEMA_TOO_NEW, schema untouched, app keeps serving from memory", async () => {
    await migrate(pool);
    await pool.query(`UPDATE ${APP_NAME}_meta SET value = '999' WHERE name = 'schema_version'`);
    const tablesBefore = await userTables();
    restart();
    const res = await health();
    expect(res.status).toBe(200);
    expect((await res.json()).persistence).toEqual({ mode: "postgres", status: "down", schemaVersion: null, error: "SCHEMA_TOO_NEW" });
    expect((await versionRows())[0]).toMatchObject({ value: "999" }); // not downgraded
    expect(await userTables()).toEqual(tablesBefore);
    expect((await postEvent(post("/api/events", { days: 1 }))).status).toBe(200);
  });

  it.each(["abc", "-1", "1.5", ""])("reports SCHEMA_CORRUPT for an unreadable version %j and changes nothing", async (bad) => {
    await migrate(pool);
    await pool.query(`UPDATE ${APP_NAME}_meta SET value = '${bad}' WHERE name = 'schema_version'`);
    restart();
    expect((await (await health()).json()).persistence).toEqual({ mode: "postgres", status: "down", schemaVersion: null, error: "SCHEMA_CORRUPT" });
    expect((await versionRows())[0]).toMatchObject({ value: bad });
  });

  it("on a mid-migration failure it rolls back (never commits), records no version, and a later boot succeeds", async () => {
    const real = pool;
    const seen: string[] = [];
    const failing: SqlPool = {
      query: (t, v) => real.query(t, v),
      connect: async () => {
        const conn = await real.connect();
        return {
          query: (t: string, v?: unknown[]) => {
            seen.push(t.trim().split(" ")[0]!);
            return t.includes("INSERT INTO") && t.includes("_meta") ? Promise.reject(Object.assign(new Error("boom"), { code: "XX000" })) : conn.query(t, v);
          },
          release: (e?: unknown) => conn.release(e),
        };
      },
    };
    await expect(migrate(failing)).rejects.toMatchObject({ code: "XX000" });
    expect(seen).toContain("ROLLBACK");
    expect(seen).not.toContain("COMMIT");
    // (Real Postgres also undoes the transactional DDL; pg-mem does not, so only the version row is asserted here.)
    expect(await versionRows()).toEqual([]);
    expect(await migrate(real)).toBe(1);
    expect(await versionRows()).toHaveLength(1);
  });
});

describe("health schemaVersion", () => {
  it("in-memory mode (no DATABASE_URL, no pool) has no persistence object, so no schemaVersion", async () => {
    usePersistencePool(null);
    delete g["__deadbeatPersistence"];
    const body = await (await health()).json();
    expect(body.ok).toBe(true);
    expect(body).not.toHaveProperty("persistence");
  });

  it("postgres mode reports the recorded integer version", async () => {
    const body = await (await health()).json();
    expect(body.persistence.schemaVersion).toBe(LATEST_SCHEMA_VERSION);
    expect(Number.isInteger(body.persistence.schemaVersion)).toBe(true);
  });

  it("postgres mode with an unreachable database reports null, still HTTP 200", async () => {
    process.env["DATABASE_URL"] = "postgres://user:pw@127.0.0.1:1/nodb";
    restart(null);
    const res = await health();
    expect(res.status).toBe(200);
    expect((await res.json()).persistence).toMatchObject({ mode: "postgres", status: "down", schemaVersion: null });
  });
});
