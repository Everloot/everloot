import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The armory pages once sent a Server-Timing header naming their internal reads (db-<function>, r2-<file>). It was a
// measuring aid; no response carries it now.
describe("worker entry", () => {
  it("does not wrap responses with a Server-Timing header", () => {
    const entry = readFileSync(new URL("./cf-entry.mjs", import.meta.url), "utf8");
    expect(entry).not.toMatch(/server-timing|ServerTiming/i);
    expect(existsSync(new URL("../src/lib/server-timing.ts", import.meta.url))).toBe(false);
  });
});
