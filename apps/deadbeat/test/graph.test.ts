import { describe, expect, it } from "vitest";
import { parseCurse } from "@curseengine/engine";
import { curseToGraph } from "@/lib/graph";
import { LATE_PAYERS_CURSE } from "@/lib/fixtures";

describe("curseToGraph", () => {
  it("shows the timer trigger, the days_overdue condition and the email action", () => {
    const g = curseToGraph(parseCurse(LATE_PAYERS_CURSE));
    expect(g.nodes.map((n) => n.kind)).toEqual(["trigger", "condition", "action"]);
    expect(g.nodes[0]?.detail).toBe("every 1 day");
    expect(g.nodes[1]?.detail).toBe("days_overdue >= 7");
    expect(g.nodes[2]?.detail).toBe("email template polite-nudge to client");
  });
});
