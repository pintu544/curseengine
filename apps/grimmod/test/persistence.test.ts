/**
 * Postgres persistence tests. NO real Postgres is used: the database is pg-mem, an in-process PostgreSQL emulator
 * (a test substitute) driven through the same pg Pool interface the app uses in production. Passing here shows the
 * SQL and the restart logic work against that emulator; it is not proof of behaviour on a real Postgres server.
 */
import { DataType, newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getGrimoire } from "../app/api/grimoire/route";
import { POST as undo } from "../app/api/grimoire/[id]/undo/route";
import { POST as postCurse } from "../app/api/curses/route";
import { GET as getGraph } from "../app/api/curses/[id]/graph/route";
import { GET as getEvents, POST as postEvent } from "../app/api/events/route";
import { GET as health } from "../app/api/health/route";
import { POST as reset } from "../app/api/reset/route";
import { EXAMPLE_CURSE } from "@/lib/fixtures";
import { SUPPRESSED_PERSIST_LIMIT } from "@/lib/host";
import { RETRY_AFTER_MS, usePersistencePool } from "@/lib/runtime";
import { LATEST_SCHEMA_VERSION, MIGRATIONS, migrate, type SqlPool } from "@/lib/persistence";

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
    expect(body).toMatchObject({ ok: true, app: "grimmod", persistence: { mode: "postgres", status: "down", schemaVersion: null, error: "ECONNREFUSED" } });
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
    expect((await (await health()).json()).persistence).toEqual({ mode: "postgres", status: "ok", schemaVersion: LATEST_SCHEMA_VERSION });

    broken = true;
    await burst(3);
    expect((await (await getEvents()).json()).chat.mutes).toHaveLength(1);
    expect((await (await health()).json()).persistence).toEqual({ mode: "postgres", status: "degraded", schemaVersion: LATEST_SCHEMA_VERSION, error: "ECONNRESET" });

    broken = false;
    await postEvent(post("/api/events", { author: "someone", text: "hello" }));
    expect((await (await health()).json()).persistence.status).toBe("ok");
    expect(await rows("SELECT seq FROM grimmod_grimoire ORDER BY seq")).toHaveLength(2);
    restart(real);
    expect((await (await getEvents()).json()).chat.mutes).toHaveLength(1);
  });
});

describe("reconnect after a failed boot", () => {
  /** A pool whose database can be switched off and on. Only Date is faked, so the reconnect rate limit can be stepped over. */
  const toggled = () => {
    const real = pool;
    const state = { broken: true };
    const gone = () => Promise.reject(Object.assign(new Error("gone"), { code: "ECONNREFUSED" }));
    const flaky: SqlPool = { query: (t, v) => (state.broken ? gone() : real.query(t, v)), connect: () => (state.broken ? gone() : real.connect()) };
    return { real, state, flaky };
  };
  const afterRetryWindow = () => vi.setSystemTime(Date.now() + RETRY_AFTER_MS + 1);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); });
  afterEach(() => { vi.useRealTimers(); });

  it("retries hydration on a later save and flushes the grimoire entries recorded while the database was down", async () => {
    const { real, state, flaky } = toggled();
    restart(flaky);
    await getEvents(); // boot attempt fails: database down
    expect((await (await health()).json()).persistence).toMatchObject({ status: "down", error: "ECONNREFUSED" });
    await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }));
    await burst(3); // third flagged message mutes and escalates: 2 entries
    const inMemory = (await (await getGrimoire()).json()).entries;
    expect(inMemory).toHaveLength(2);
    expect(await real.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'grimmod_grimoire'").then((r) => r.rows)).toEqual([]); // nothing reached the store

    state.broken = false;
    afterRetryWindow();
    await postEvent(post("/api/events", { author: "someone", text: "hello" }));
    expect((await (await health()).json()).persistence).toEqual({ mode: "postgres", status: "ok", schemaVersion: LATEST_SCHEMA_VERSION });
    const stored = await rows("SELECT seq, entry FROM grimmod_grimoire ORDER BY seq");
    expect(stored).toHaveLength(2);
    expect(stored.map((r) => (r["entry"] as any).id)).toEqual(inMemory.map((e: any) => e.id));

    restart(real); // the entries and state now survive a restart
    expect((await (await getGrimoire()).json()).entries).toHaveLength(2);
  });

  it("does not overwrite a database that already holds state: stays down with HYDRATE_CONFLICT and leaves every row untouched", async () => {
    restart(); // healthy boot, persist some state and entries
    await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }));
    await burst(3); // third flagged message mutes and escalates: 2 entries
    const stateRows = await rows("SELECT id, epoch, snapshot FROM grimmod_state");
    const grimRows = await rows("SELECT epoch, seq, entry FROM grimmod_grimoire ORDER BY seq");
    expect(grimRows).toHaveLength(2);

    const { state, flaky } = toggled();
    restart(flaky); // new process, database down at boot, diverging in-memory work
    await getEvents();
    await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }));
    await burst(3); // third flagged message mutes and escalates: 2 entries
    state.broken = false;
    afterRetryWindow();
    await postEvent(post("/api/events", { author: "someone", text: "hello" }));

    expect((await (await health()).json()).persistence).toMatchObject({ status: "down", error: "HYDRATE_CONFLICT" });
    expect(await rows("SELECT id, epoch, snapshot FROM grimmod_state")).toEqual(stateRows);
    expect(await rows("SELECT epoch, seq, entry FROM grimmod_grimoire ORDER BY seq")).toEqual(grimRows);
  });
});

const APP_NAME = "grimmod";
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
    expect((await postEvent(post("/api/events", { author: "someone", text: "hello" }))).status).toBe(200);
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
    delete g["__grimmodPersistence"];
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

describe("suppressed list cap (W1)", () => {
  const snapshotRow = async () => (await rows("SELECT snapshot FROM grimmod_state WHERE id = 'host'"))[0]!["snapshot"] as { suppressed: { eventId: string }[]; suppressedTotal?: number; v: number };
  /** Mutes raid-bot (3 flagged messages), then sends `n` more messages from the muted author: each one is suppressed. */
  const suppressMany = async (n: number) => {
    await postCurse(post("/api/curses", { source: EXAMPLE_CURSE }));
    await burst(3);
    for (let i = 0; i < n; i++) await postEvent(post("/api/events", { author: "raid-bot", text: `muted ${i}` }));
  };

  it("the cap is 200", () => {
    expect(SUPPRESSED_PERSIST_LIMIT).toBe(200);
  });

  it("persists only the latest 200 suppressed entries but keeps the exact total, and the API still shows latest 50 + total after a restart", async () => {
    await suppressMany(260);
    const live = await (await getGrimoire()).json();
    expect(live.suppressedTotal).toBe(260);
    expect(live.suppressed).toHaveLength(50);
    expect(live.suppressedTruncated).toBe(true);

    const row = await snapshotRow();
    expect(row.suppressed).toHaveLength(200);
    expect(row.suppressedTotal).toBe(260);
    expect(row.v).toBe(1); // snapshot format version is independent of the schema version
    // The 200 kept are the NEWEST ones: the last kept is the last suppressed.
    expect(row.suppressed.at(-1)!.eventId).toBe(live.suppressed.at(-1).eventId);

    restart();
    const after = await (await getGrimoire()).json();
    expect(after).toEqual(live); // same total, same latest-50 window, same flag
    const { getHost } = await import("@/lib/host");
    expect(getHost().suppressed).toHaveLength(200);
    expect(getHost().suppressedTotal).toBe(260);

    // Counting continues from the preserved total, and the window keeps sliding.
    await postEvent(post("/api/events", { author: "raid-bot", text: "one more" }));
    const next = await (await getGrimoire()).json();
    expect(next.suppressedTotal).toBe(261);
    expect(getHost().suppressed).toHaveLength(200);
  });

  it("below the cap nothing is dropped and the numbers are exact", async () => {
    await suppressMany(60);
    const row = await snapshotRow();
    expect(row.suppressed).toHaveLength(60);
    expect(row.suppressedTotal).toBe(60);
    restart();
    const g2 = await (await getGrimoire()).json();
    expect(g2).toMatchObject({ suppressedTotal: 60, suppressedTruncated: true });
    expect(g2.suppressed).toHaveLength(50);
  });

  it("restores a snapshot written before the cap existed (no suppressedTotal): total defaults to the list length", async () => {
    await suppressMany(5);
    const row = await snapshotRow();
    const { suppressedTotal: _drop, ...legacy } = row;
    await pool.query("UPDATE grimmod_state SET snapshot = $1::jsonb WHERE id = 'host'", [JSON.stringify(legacy)]);
    restart();
    const g2 = await (await getGrimoire()).json();
    expect(g2.suppressedTotal).toBe(5);
    expect(g2.suppressed).toHaveLength(5);
  });

  it("restores an old UNBOUNDED snapshot (300 entries, no total): keeps the latest 200, total stays 300", async () => {
    await suppressMany(1);
    const row = await snapshotRow();
    const big = Array.from({ length: 300 }, (_, i) => ({ eventId: `old-${i}`, author: "raid-bot", at: i }));
    await pool.query("UPDATE grimmod_state SET snapshot = $1::jsonb WHERE id = 'host'", [JSON.stringify({ ...row, suppressed: big, suppressedTotal: undefined })]);
    restart();
    const g2 = await (await getGrimoire()).json();
    expect(g2.suppressedTotal).toBe(300);
    expect(g2.suppressed.at(-1).eventId).toBe("old-299");
    const { getHost } = await import("@/lib/host");
    expect(getHost().suppressed).toHaveLength(200);
    expect(getHost().suppressed[0]!.eventId).toBe("old-100");
  });

  it("a demo reset clears the list and the total", async () => {
    await suppressMany(10);
    await reset();
    expect((await (await getGrimoire()).json())).toMatchObject({ suppressedTotal: 0, suppressed: [] });
    expect((await snapshotRow()).suppressedTotal).toBe(0);
  });
});
