import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/**
 * Mechanical pin for .kiro/agents/grimoire-auditor.md (spec: grimoire-auditor-agent R1-R5).
 * Hand-written parser for the small YAML subset the front matter uses; no dependency.
 */
const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const raw = readFileSync(resolve(root, ".kiro/agents/grimoire-auditor.md"), "utf8");

const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
const fm = m ? m[1]! : "";
const body = m ? m[2]! : "";
const lines = fm.split(/\r?\n/);

function scalar(key: string): string | undefined {
  const l = lines.find((x) => x.startsWith(`${key}:`));
  return l === undefined ? undefined : l.slice(key.length + 1).trim();
}
function inlineList(key: string): string[] | undefined {
  const v = scalar(key);
  if (v === undefined || !v.startsWith("[")) return undefined;
  return JSON.parse(v) as string[];
}
function topLevelKeys(): string[] {
  return lines.filter((l) => /^[A-Za-z]/.test(l)).map((l) => l.split(":")[0]!);
}
function resources(): string[] {
  const out: string[] = [];
  let inside = false;
  for (const l of lines) {
    if (/^resources:/.test(l)) { inside = true; continue; }
    if (inside) {
      const mm = /^\s+-\s+(.*)$/.exec(l);
      if (mm) out.push(mm[1]!.trim());
      else if (/^[A-Za-z]/.test(l)) inside = false;
    }
  }
  return out;
}
function rules(): { capability: string; match: string[]; effect: string }[] {
  const out: { capability: string; match: string[]; effect: string }[] = [];
  let cur: Partial<{ capability: string; match: string[]; effect: string }> | null = null;
  for (const l of lines) {
    let mm;
    if ((mm = /^\s+-\s+capability:\s*(\S+)/.exec(l))) { cur = { capability: mm[1]! }; out.push(cur as never); }
    else if (cur && (mm = /^\s+match:\s*(\[.*\])/.exec(l))) cur.match = JSON.parse(mm[1]!);
    else if (cur && (mm = /^\s+effect:\s*(\S+)/.exec(l))) cur.effect = mm[1]!;
  }
  return out;
}

describe("grimoire-auditor agent config", () => {
  it("has front matter and a non-empty system prompt body", () => {
    expect(m).not.toBeNull();
    expect(body.trim().length).toBeGreaterThan(200);
  });

  it("is named grimoire-auditor", () => {
    expect(scalar("name")).toBe("grimoire-auditor");
  });

  it("tools is exactly [read]; nothing writable, executable, web or wildcard anywhere in tools", () => {
    expect(inlineList("tools")).toEqual(["read"]);
    const toolsLine = lines.find((l) => l.startsWith("tools:"))!;
    for (const bad of ["write", "shell", "web", "subagent", "@", "*"]) expect(toolsLine).not.toContain(bad);
  });

  it("denies fs_write, shell, web_fetch, web_search and mcp, and allows fs_read", () => {
    const r = rules();
    for (const cap of ["fs_write", "shell", "web_fetch", "web_search", "mcp"]) {
      const hit = r.filter((x) => x.capability === cap);
      expect(hit.length, cap).toBeGreaterThan(0);
      expect(hit.every((x) => x.effect === "deny"), cap).toBe(true);
    }
    const read = r.filter((x) => x.capability === "fs_read");
    expect(read.length).toBeGreaterThan(0);
    expect(read.every((x) => x.effect === "allow")).toBe(true);
    expect(r.filter((x) => x.effect === "allow").map((x) => x.capability)).toEqual(["fs_read"]);
  });

  it("resources are exactly inviolables.md and grammar.md, and both exist", () => {
    const res = resources();
    expect(res).toEqual(["file://.kiro/steering/inviolables.md", "file://docs/grammar.md"]);
    for (const r of res) expect(existsSync(resolve(root, r.slice("file://".length))), r).toBe(true);
  });

  it("defines no mcpServers or hooks, and excludes MCP json and powers", () => {
    const keys = topLevelKeys();
    expect(keys).not.toContain("mcpServers");
    expect(keys).not.toContain("hooks");
    expect(scalar("includeMcpJson")).toBe("false");
    expect(scalar("includePowers")).toBe("false");
  });

  it("restates the inviolables and the four audit classes in the prompt", () => {
    for (const s of ["No exfiltration", "never executes side effects", "reversible", "the files win", "every", "Read only what you cite"]) {
      expect(body.toLowerCase()).toContain(s.toLowerCase());
    }
  });
});
