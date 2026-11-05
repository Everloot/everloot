import { expect, test, vi } from "vitest";

const read = vi.hoisted(() => ({ unreachable: false, names: null as unknown }));
vi.mock("@/lib/rollup-compute", () => ({
  loadItemFacts: async () => ({ rates: [], names: [], npcs: [], unreachable: read.unreachable }),
}));
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadItemNames: async () => read.names,
}));

import { PRIVATE_UNREACHABLE } from "@/lib/game-assets";
import { loadShownNames } from "./shown-item-names";

const names = { version: "1.60.1.70450", wiki: { name: "Warcraft Wiki", url: "" }, names: new Map([[25, { name: "Worn Shortsword", color: "#ffffff", wikiPage: null, source: "files" as const }]]) };

test("a read with upload storage or the game file names out of reach is degraded; one without the names file is not", async () => {
  Object.assign(read, { unreachable: false, names });
  const whole = await loadShownNames();
  expect(whole.degraded).toBe(false);
  expect(whole.matched?.names.get(25)?.name).toBe("Worn Shortsword");

  Object.assign(read, { unreachable: false, names: PRIVATE_UNREACHABLE });
  const unread = await loadShownNames();
  expect(unread.degraded).toBe(true);
  expect(unread.matched).toBeNull();
  expect(unread.named.has(25)).toBe(false);

  Object.assign(read, { unreachable: true, names });
  expect((await loadShownNames()).degraded).toBe(true);

  // No bucket configured, no file for this build: the page is whole without file names.
  Object.assign(read, { unreachable: false, names: null });
  expect((await loadShownNames()).degraded).toBe(false);
});
