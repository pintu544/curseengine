import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCurse, simulate, summaryLine, type Curse, type EngineEvent } from "@curseengine/engine";

const dir = fileURLToPath(new URL("../curses/", import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".curse")).sort();
const curses: Curse[] = files.map((f) => parseCurse(readFileSync(`${dir}${f}`, "utf8").trim()));

const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 9, 26, 9, 0, 0); // Monday 26 October 2026, 09:00 UTC

/** One standup update. `flagged` means the member reported a blocker. */
const update = (id: string, day: number, member: string, text: string, flagged = false): EngineEvent => ({
  id, type: "standup", at: START + day * DAY, flagged, fields: { member, update: text, flagged },
});

/** Tiny fixture history: a week of standups for three team members. */
const history: EngineEvent[] = [
  update("s-01", 0, "asha", "shipped the invoice export"),
  update("s-02", 0, "ben", "blocked on the staging database", true),
  update("s-03", 0, "caro", "reviewing pull requests"),
  update("s-04", 1, "ben", "still blocked on the staging database", true),
  update("s-05", 1, "asha", "started on the digest layout"),
  update("s-06", 2, "ben", "blocked, waiting on access", true),
  update("s-07", 2, "caro", "shipped the retry fix"),
  update("s-08", 3, "asha", "pairing with caro"),
];

describe("standup rule-pack", () => {
  it("ships three curses that parse and use only the standup event with post and escalate actions", () => {
    expect(files).toEqual(["blocked-three-days.curse", "blocker-callout.curse", "shipped-digest.curse"]);
    for (const c of curses) {
      expect(JSON.stringify(c)).toContain("standup");
      expect(c.actions.every((a) => a.kind === "post" || a.kind === "escalate")).toBe(true);
    }
  });

  it("dry-runs over the fixture history through simulate() and prints the report", async () => {
    const report = await simulate({ curses, events: history, quotaPerHour: 1000, declared: ["post", "escalate"] });
    const lines = [
      `standup pack dry run: ${history.length} events, ${curses.length} curses`,
      ...report.intended.map((a) => `  ${a.curse.padEnd(20)} ${a.eventId}  ${a.kind.padEnd(8)} -> ${a.target}${a.message ? `  "${a.message}"` : ""}`),
      `summary: ${summaryLine(report)}`,
    ];
    console.log(lines.join("\n"));

    // Nothing is executed: the report only lists what would have happened.
    expect(report.summary.events).toBe(history.length);
    expect(report.suppressed).toEqual([]);
    expect(report.intended.filter((a) => a.curse === "shipped-digest").map((a) => a.eventId)).toEqual(["s-01", "s-07"]);
    // Ben raises blockers on s-02, s-04 and s-06 ("blocked" appears in all three).
    expect(report.intended.filter((a) => a.curse === "blocker-callout" && a.kind === "post").map((a) => a.eventId)).toEqual(["s-02", "s-04", "s-06"]);
    // Three flagged updates from the same member within 7 days: escalate on the third only.
    expect(report.intended.filter((a) => a.curse === "blocked-three-days").map((a) => a.eventId)).toEqual(["s-06"]);
    expect(report.summary.byKind.mute.taken + report.summary.byKind.email.taken).toBe(0);
  });
});
