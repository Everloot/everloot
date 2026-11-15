import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { CLASSES } from "@/design/tokens";
import { chooserIndexable, loadChooser } from "./class-chooser-file";
import { startTiles, startHref } from "./start-here";

const app = join(import.meta.dirname, "../app");
function routeExists(href: string) {
  const path = href.split(/[?#]/)[0];
  if (existsSync(join(app, path, "page.tsx"))) return true;
  return CLASSES.some((slug) => path.endsWith(`/${slug}`) && existsSync(join(app, path.slice(0, -slug.length), "[class]/page.tsx")));
}

test("nine to ten useful jobs have real routes with or without a remembered class and character pages", () => {
  for (const armory of [false, true]) for (const players of [false, true]) {
    const tiles = startTiles(armory, players);
    expect(tiles).toHaveLength(armory || players ? 10 : 9);
    expect(new Set(tiles.map((t) => t.key)).size).toBe(tiles.length);
    for (const context of [null, ...CLASSES.map((classSlug) => ({ classSlug }))]) {
      for (const tile of tiles) {
        expect(routeExists(startHref(tile, context)), startHref(tile, context)).toBe(true);
        expect(tile.label.length).toBeGreaterThan(0);
        expect(tile.note.length).toBeGreaterThan(0);
      }
    }
  }
  expect(startTiles(false, true).find((t) => t.key === "character")?.href).toBe("/players");
});

test("talents and class hubs open directly on the remembered class", () => {
  const tiles = startTiles(true);
  expect(startHref(tiles.find((t) => t.key === "talents")!, { classSlug: "mage" })).toBe("/tools/talents/mage");
  expect(startHref(tiles.find((t) => t.key === "class")!, { classSlug: "druid", level: 25, role: "healer" })).toBe("/classes/druid?level=25&role=healer");
});

test("the draft class quiz stays gated and is never a start tile", () => {
  expect(loadChooser()?.chooser.status).toBe("draft");
  expect(chooserIndexable(loadChooser())).toBe(false);
  for (const enabled of [false, true]) for (const tile of startTiles(enabled)) expect(tile.href).not.toContain("/classes/choose");
});

test("disabled character pages never become a dead shortcut", () => {
  expect(startTiles(false).some((t) => t.key === "character")).toBe(false);
});
