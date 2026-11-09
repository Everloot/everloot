import { it, expect } from "vitest";
import { armoryCrawl } from "./index.js";
it("rejects --budget without a value before reading credentials", async () => {
  await expect(
    armoryCrawl(
      new Map([
        ["region", "eu"],
        ["budget", ""],
      ]),
    ),
  ).rejects.toThrow("--budget requires a value");
});
