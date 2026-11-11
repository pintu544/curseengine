import { beforeEach, describe, expect, it } from "vitest";
import { parseCurse } from "@curseengine/engine";
import { POST as postCurse } from "../app/api/curses/route";
import { POST as reset } from "../app/api/reset/route";
import { EXAMPLE_CURSE } from "@/lib/fixtures";
import { installWarnings } from "@/lib/install-warnings";

const post = (body: unknown) =>
  new Request("http://test/api/curses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("installWarnings (GrimMod)", () => {
  it("is empty for the shipped fixture curse and any message curse", () => {
    expect(installWarnings(parseCurse(EXAMPLE_CURSE))).toEqual([]);
    expect(installWarnings(parseCurse('curse m: when message -> post "hi" to ops'))).toEqual([]);
  });

  it("warns for an every trigger", () => {
    const w = installWarnings(parseCurse('curse t: every 1 day -> post "hi" to ops'));
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/no tick events/);
  });

  it("warns for a webhook trigger", () => {
    const w = installWarnings(parseCurse('curse h: on webhook /pay -> post "paid" to ops'));
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/no webhook intake.*\/pay/);
  });
});

describe("POST /api/curses warnings (GrimMod)", () => {
  beforeEach(async () => {
    await reset();
  });

  it("returns an empty warnings array for the fixture curse", async () => {
    const res = await postCurse(post({ source: EXAMPLE_CURSE }));
    expect(res.status).toBe(201);
    expect((await res.json()).warnings).toEqual([]);
  });

  it("still returns 201 with the usual fields plus a warning for an every curse", async () => {
    const res = await postCurse(post({ source: 'curse tick-me: every 1 day -> post "hi" to ops' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("tick-me");
    expect(body.graph.nodes.length).toBeGreaterThan(0);
    expect(body.warnings).toHaveLength(1);
  });
});
