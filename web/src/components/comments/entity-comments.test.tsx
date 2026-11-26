import { readdirSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { prerenderToNodeStream } from "react-dom/static";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/database/items/19019" }));
vi.mock("next/dynamic", async () => ({ default: (await import("react")).lazy }));
vi.mock("@/lib/supabase/server", () => ({ getUser: vi.fn(), authQuery: vi.fn(), siteUrl: () => "https://everloot.app" }));

import EntityComments from "./EntityComments";

afterEach(() => vi.unstubAllEnvs());

test("renders nothing unless EVERLOOT_COMMENTS=1 with profiles on", () => {
  for (const [comments, profiles] of [[undefined, "1"], ["1", undefined], ["yes", "1"]]) {
    vi.stubEnv("EVERLOOT_COMMENTS", comments as string);
    vi.stubEnv("EVERLOOT_PROFILES", profiles as string);
    expect(renderToStaticMarkup(<EntityComments type="item" id={19019} />)).toBe("");
  }
});

// The section is loaded lazily, so read the HTML the way the server sends it: after it has loaded. Outside Next's
// compiler next/dynamic is the pages-router loader, which draws nothing on the server; the app router's is React.lazy.
async function fullHtml(node: React.ReactNode): Promise<string> {
  const { prelude } = await prerenderToNodeStream(node);
  let html = "";
  for await (const chunk of prelude) html += chunk;
  return html;
}

test("on, the page's HTML holds the empty section and no comment, viewer or session", async () => {
  vi.stubEnv("EVERLOOT_COMMENTS", "1");
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  const html = await fullHtml(<EntityComments type="item" id={19019} />);
  expect(html).toContain('id="comments"');
  expect(html).toContain("Loading comments");
  expect(html).not.toMatch(/Sign in|@\w|textarea/);
});

// Its code is a chunk of its own, so a page with the switch off (all of them today) never downloads it.
test("the section's code reaches a page only through the lazy loader", () => {
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  expect(read("./EntityComments.tsx")).not.toMatch(/from "\.\/CommentsSection"/);
  expect(read("./LazyCommentsSection.tsx")).toMatch(/dynamic\(\(\) => import\("\.\/CommentsSection"\)\)/);
  // The barrel would pull every UI part into the chunk.
  expect(read("./CommentsSection.tsx")).not.toMatch(/from "@\/components\/ui"/);
});

test("site only: nothing but the comments route, the moderation page and route, and this section reads comments", () => {
  const src = new URL("../../", import.meta.url);
  const allowed = new Set(["app/comments/route.ts", "app/comments/moderate/route.ts", "app/ops/comments/page.tsx", "components/comments/EntityComments.tsx"]);
  const readers = readdirSync(src, { recursive: true, encoding: "utf8" })
    .map((f) => f.replaceAll("\\", "/"))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("lib/comments"))
    .filter((f) => /from "@\/lib\/comments"|from "\.\/comments"|entity_comments|comment_moderation_queue/.test(readFileSync(new URL(f, src), "utf8")));
  expect(readers.filter((f) => !allowed.has(f))).toEqual([]);
});

test("the item, quest, NPC, spell, zone and instance pages each render it with their own type and id", () => {
  const pages: Array<[string, string]> = [
    ["../../app/database/items/[id]/page.tsx", '<EntityComments type="item" id={itemId} />'],
    ["../../app/database/quests/[id]/page.tsx", '<EntityComments type="quest" id={page.questId} />'],
    ["../../app/database/npcs/[id]/page.tsx", '<EntityComments type="npc" id={npcId} />'],
    ["../../app/database/spells/[id]/page.tsx", '<EntityComments type="spell" id={spellId} />'],
    ["../../app/database/zones/[zone]/page.tsx", '<EntityComments type="zone" id={zone.mapId} />'],
    ["../../app/database/instances/[instance]/page.tsx", '<EntityComments type="instance" id={row.instanceMapId} />'],
  ];
  for (const [path, line] of pages) expect(readFileSync(new URL(path, import.meta.url), "utf8"), path).toContain(line);
});

test("the browser's requests go to routes the middleware lets through, not the ad-free /ops paths", async () => {
  const { isAdFreePath } = await import("@/lib/document-boundary");
  const { COMMENTS_ROUTE, MODERATION_ROUTE } = await import("@/lib/comments-shared");
  const { config } = await import("@/middleware");
  for (const route of [COMMENTS_ROUTE, MODERATION_ROUTE]) {
    expect(isAdFreePath(route), route).toBe(false);
    // "/" matches the root alone; "/x/:path*" matches /x and everything under it.
    expect(config.matcher.some((m) => (m.endsWith("/:path*") ? route === m.slice(0, -7) || route.startsWith(m.slice(0, -6)) : route === m)), route).toBe(false);
  }
});
