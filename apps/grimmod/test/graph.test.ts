import { describe, expect, it } from "vitest";
import { parseCurse } from "@curseengine/engine";
import { EXAMPLE_CURSE } from "@/lib/fixtures";
import { curseToGraph } from "@/lib/graph";

describe("curseToGraph", () => {
  it("renders trigger -> condition -> actions for the example curse", () => {
    const g = curseToGraph(parseCurse(EXAMPLE_CURSE));
    expect(g.name).toBe("spam-strikes");
    expect(g.nodes.map((n) => n.kind)).toEqual(["trigger", "condition", "action", "action"]);
    expect(g.nodes[0]!.detail).toBe("when message");
    expect(g.nodes[1]!.detail).toBe("count(message by same author flagged) >= 3 within 7 days");
    expect(g.nodes[2]!.detail).toBe("mute author for 1 day");
    expect(g.nodes[3]!.detail).toBe("escalate to owner");
    expect(g.edges.map((e) => [e.from, e.to])).toEqual([
      ["trigger", "condition-1"],
      ["condition-1", "action-1"],
      ["action-1", "action-2"],
    ]);
  });

  it("keeps and/or connectors in source order", () => {
    const g = curseToGraph(parseCurse('curse c: when message where text contains "a" and flagged = true or author = bob -> escalate to owner'));
    expect(g.nodes.filter((n) => n.kind === "condition")).toHaveLength(3);
    expect(g.edges.filter((e) => e.label).map((e) => e.label)).toEqual(["and", "or"]);
  });
});
