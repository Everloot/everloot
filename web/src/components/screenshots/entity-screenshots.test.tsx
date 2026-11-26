import { readdirSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/database/items/19019" }));
vi.mock("@/lib/supabase/server", () => ({ getUser: vi.fn(), authQuery: vi.fn(), siteUrl: () => "https://everloot.app" }));

import EntityScreenshots from "./EntityScreenshots";

afterEach(() => vi.unstubAllEnvs());

test("renders nothing unless EVERLOOT_SCREENSHOTS=1 with profiles on", () => {
  for (const [shots, profiles] of [[undefined, "1"], ["1", undefined], ["yes", "1"]]) {
    vi.stubEnv("EVERLOOT_SCREENSHOTS", shots as string);
    vi.stubEnv("EVERLOOT_PROFILES", profiles as string);
    expect(renderToStaticMarkup(<EntityScreenshots type="item" id={19019} name="Thunderfury" />)).toBe("");
  }
});

test("on, the page's HTML holds the empty section: no picture, no viewer, no session, so the page stays cacheable", () => {
  vi.stubEnv("EVERLOOT_SCREENSHOTS", "1");
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  const html = renderToStaticMarkup(<EntityScreenshots type="item" id={19019} name="Thunderfury" />);
  expect(html).toContain('id="screenshots"');
  expect(html).not.toMatch(/<img|<form|Sign in|@\w|type="file"/);
});

test("site only: nothing but the screenshot routes, the moderation page and this section reads screenshots", () => {
  const src = new URL("../../", import.meta.url);
  const allowed = new Set([
    "app/screenshots/route.ts", "app/screenshots/mine/route.ts", "app/screenshots/moderate/route.ts", "app/screenshots/file/[id]/route.ts",
    "app/screenshots/review/[id]/route.ts", "app/ops/screenshots/page.tsx", "components/screenshots/EntityScreenshots.tsx",
  ]);
  const readers = readdirSync(src, { recursive: true, encoding: "utf8" })
    .map((f) => f.replaceAll("\\", "/"))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("lib/screenshots") && !f.startsWith("test/"))
    .filter((f) => /from "@\/lib\/screenshots"|from "\.\/screenshots"|entity_screenshots|screenshot_moderation_queue|SCREENSHOTS_BUCKET|env\.SCREENSHOTS/.test(readFileSync(new URL(f, src), "utf8")));
  expect(readers.filter((f) => !allowed.has(f))).toEqual([]);
});

test("the item, quest, NPC, spell, zone and instance pages each render it with their type, id and shown name, before the comments", () => {
  const pages: Array<[string, string, string]> = [
    ["../../app/database/items/[id]/page.tsx", '<EntityScreenshots type="item" id={itemId} name={title} />', '<EntityComments type="item"'],
    ["../../app/database/quests/[id]/page.tsx", '<EntityScreenshots type="quest" id={page.questId} name={title} />', '<EntityComments type="quest"'],
    ["../../app/database/npcs/[id]/page.tsx", '<EntityScreenshots type="npc" id={npcId} name={title} />', '<EntityComments type="npc"'],
    ["../../app/database/spells/[id]/page.tsx", '<EntityScreenshots type="spell" id={spellId} name={title} />', '<EntityComments type="spell"'],
    ["../../app/database/zones/[zone]/page.tsx", '<EntityScreenshots type="zone" id={zone.mapId} name={zone.name} />', '<EntityComments type="zone"'],
    ["../../app/database/instances/[instance]/page.tsx", '<EntityScreenshots type="instance" id={row.instanceMapId} name={title} />', '<EntityComments type="instance"'],
  ];
  for (const [path, line, comments] of pages) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    expect(source, path).toContain(line);
    expect(source.indexOf(line), path).toBeLessThan(source.indexOf(comments));
  }
});

test("the browser's requests go to routes the middleware lets through, not the ad-free /ops paths, and the gallery is not a private path", async () => {
  const { isAdFreePath } = await import("@/lib/document-boundary");
  const { isPrivatePath } = await import("@/lib/cf-edge-cache");
  const shared = await import("@/lib/screenshots-shared");
  const { config } = await import("@/middleware");
  const id = "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11";
  for (const route of [shared.SCREENSHOTS_ROUTE, shared.OWN_SCREENSHOTS_ROUTE, shared.SCREENSHOT_MODERATION_ROUTE, shared.screenshotFileHref(id), shared.screenshotReviewHref(id)]) {
    expect(isAdFreePath(route), route).toBe(false);
    expect(config.matcher.some((m) => (m.endsWith("/:path*") ? route === m.slice(0, -7) || route.startsWith(m.slice(0, -6)) : route === m)), route).toBe(false);
  }
  expect(isPrivatePath(shared.SCREENSHOTS_ROUTE)).toBe(false);
  expect(isPrivatePath(shared.screenshotFileHref(id))).toBe(false);
});
