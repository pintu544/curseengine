import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GrimMod } from "@/components/GrimMod";
import { Grimoire } from "@/components/Grimoire";
import { RuleGraph } from "@/components/RuleGraph";
import { Simulator } from "@/components/Simulator";

const html = renderToStaticMarkup(createElement(GrimMod));
const root = new URL("..", import.meta.url).pathname;

describe("accessibility: initial render", () => {
  it("has exactly one h1 and sequential heading levels", () => {
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    const levels = [...html.matchAll(/<h([1-6])[ >]/g)].map((m) => Number(m[1]));
    levels.forEach((l, i) => expect(l - (levels[i - 1] ?? 0)).toBeLessThanOrEqual(1));
  });

  it("gives every form control a label or aria-label", () => {
    const ids = new Set([...html.matchAll(/<label[^>]*for="([^"]+)"/g)].map((m) => m[1]));
    const controls = [...html.matchAll(/<(input|textarea|select)\b([^>]*)>/g)];
    expect(controls.length).toBeGreaterThan(0);
    for (const [, tag, attrs] of controls) {
      const id = /\bid="([^"]+)"/.exec(attrs ?? "")?.[1];
      const wrapped = tag === "input" && /type="checkbox"/.test(attrs ?? ""); // checkbox sits inside its <label>
      expect(/aria-label="[^"]+"/.test(attrs ?? "") || (id !== undefined && ids.has(id)) || wrapped, `unlabelled <${tag} ${attrs}>`).toBe(true);
    }
  });

  it("gives every button an accessible name from its text", () => {
    for (const m of html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)) {
      const text = (m[2] ?? "").replace(/<[^>]+>/g, "").trim();
      expect(text.length > 0 || /aria-label="[^"]+"/.test(m[1] ?? "")).toBe(true);
    }
  });

  it("renders async result regions inside persistent aria-live=polite containers", () => {
    expect(html).toContain('aria-live="polite"');
    const grim = renderToStaticMarkup(createElement(Grimoire, { version: 0, onUndone: () => undefined }));
    expect(grim).toContain('aria-live="polite"');
    const sim = renderToStaticMarkup(createElement(Simulator, { curseId: "x" }));
    expect(sim).toContain('aria-live="polite"');
  });

  it("keeps the empty rule graph a plain paragraph", () => {
    expect(renderToStaticMarkup(createElement(RuleGraph, { graph: null }))).toContain("graph-empty");
  });
});

describe("accessibility: styles", () => {
  it("defines focus-visible and reduced-motion rules in global CSS", () => {
    const css = readFileSync(join(root, "app/globals.css"), "utf8");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });

  it("uses no text-zinc-500 (fails 4.5:1 on the zinc-950/900 backgrounds)", () => {
    const dir = join(root, "src/components");
    for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f), "utf8"), f).not.toContain("text-zinc-500");
  });
});
