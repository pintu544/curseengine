import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error plain .mjs config without type declarations
import nextConfig from "../next.config.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

describe("deployment shape", () => {
  it("builds a standalone server", () => {
    expect(nextConfig.output).toBe("standalone");
  });

  // Only checkable after `next build`; fails if a build ran without emitting the entry.
  it.skipIf(!existsSync(`${appRoot}.next/BUILD_ID`))(
    "emits a standalone server.js after a production build",
    () => {
      const found = [".next/standalone/server.js", ".next/standalone/apps/grimmod/server.js"].some((p) => existsSync(appRoot + p));
      expect(found).toBe(true);
    },
  );
});
