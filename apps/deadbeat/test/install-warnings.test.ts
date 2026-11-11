import { beforeEach, describe, expect, it } from "vitest";
import { parseCurse } from "@curseengine/engine";
import { POST as postCurse } from "../app/api/curses/route";
import { POST as reset } from "../app/api/reset/route";
import { TIER_CURSES } from "@/lib/fixtures";
import { installWarnings } from "@/lib/install-warnings";

const post = (body: unknown) =>
  new Request("http://test/api/curses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const curse = (trigger: string) => parseCurse(`curse c: ${trigger} -> escalate to owner`);

describe("installWarnings (Deadbeat)", () => {
  it("is empty for every shipped fixture curse", () => {
    for (const src of TIER_CURSES) expect(installWarnings(parseCurse(src))).toEqual([]);
  });

  it("accepts any interval equal to one day in milliseconds", () => {
    expect(installWarnings(curse("every 24 hours"))).toEqual([]);
    expect(installWarnings(curse("every 1440 minutes"))).toEqual([]);
  });

  it("warns for intervals other than one day", () => {
    for (const t of ["every 1 hour", "every 7 days", "every 1 week"]) {
      const w = installWarnings(curse(t));
      expect(w, t).toHaveLength(1);
      expect(w[0]).toMatch(/once per day/);
    }
  });

  it("warns for event and webhook triggers", () => {
    expect(installWarnings(curse("when message"))[0]).toMatch(/only tick events.*when message/);
    expect(installWarnings(curse("on webhook /pay"))[0]).toMatch(/no webhook intake.*\/pay/);
  });
});

describe("POST /api/curses warnings (Deadbeat)", () => {
  beforeEach(async () => {
    await reset();
  });

  it("returns an empty warnings array for a fixture curse", async () => {
    const res = await postCurse(post({ source: TIER_CURSES[0] }));
    expect(res.status).toBe(201);
    expect((await res.json()).warnings).toEqual([]);
  });

  it("still returns 201 with the usual fields plus a warning for a dead trigger", async () => {
    const res = await postCurse(post({ source: "curse weekly: every 7 days -> escalate to owner" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("weekly");
    expect(body.graph.nodes.length).toBeGreaterThan(0);
    expect(body.warnings).toHaveLength(1);
  });
});
