import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parse } from "yaml";
import { WatchConfig } from "../src/build-watch/watch.js";

// Everything read from a product that players cannot play yet is a spoiler (docs/DATA_POLICY.md). WoW Forever
// launched on 2026-11-04 (docs/LAUNCH_DAY.md, step 20), so `live` is true and items read from it are not spoilers.
test("the build watch follows WoW Forever's own product, marked live", () => {
  const config = WatchConfig.parse(parse(readFileSync(new URL("../lists/build-watch.yaml", import.meta.url), "utf8")));
  expect(config.products).toEqual([{ product: "wowf", label: "WoW Forever", live: true }]);
});
