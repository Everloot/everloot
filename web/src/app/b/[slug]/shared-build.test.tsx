import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/b/AbCd1234",
}));
const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));

import SharedBuildPage, { generateMetadata } from "./page";
import { GET as card } from "@/app/tools/talents/[class]/card/route";
import { loadCatalog } from "@/lib/talents/catalogs";
import { encodeBuild } from "@/lib/talents/share";

let code = "";
const shared = (over: object = {}) => [{
  name: "Raid frost", notes: "Two sets.\nSwap for heroics.", class_slug: "mage", code, code2: null, game_build: "",
  character_name: "Jaina", character_class: "mage", owner_name: null, updated_at: "2026-10-20T12:00:00+00:00", ...over,
}];
const params = (slug = "AbCd1234") => ({ params: Promise.resolve({ slug }) });

beforeEach(async () => {
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "1");
  const catalog = await loadCatalog("mage");
  const first = catalog.nodes.find((n) => !n.unlock && n.prereqs.length === 0 && !n.anyOf)!;
  code = encodeBuild({ classSlug: "mage", specId: 0, build: catalog.build, ranks: { [first.id]: { rank: 1 } } });
  auth.getUser.mockReset().mockResolvedValue(null);
  auth.authQuery.mockReset().mockImplementation(async () => shared({ game_build: catalog.build }));
});
afterEach(() => { vi.unstubAllEnvs(); });

test("with the switch off the link is a 404 and the database is not asked", async () => {
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "");
  await expect(SharedBuildPage(params())).rejects.toThrow("NEXT_NOT_FOUND");
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("an unknown, unshared or deleted build is a 404, and so is a malformed slug", async () => {
  auth.authQuery.mockResolvedValue([]);
  await expect(SharedBuildPage(params())).rejects.toThrow("NEXT_NOT_FOUND");
  expect(JSON.parse(auth.authQuery.mock.calls[0][1].body)).toEqual({ p_slug: "AbCd1234" });
  auth.authQuery.mockClear();
  await expect(SharedBuildPage(params("../../x"))).rejects.toThrow("NEXT_NOT_FOUND");
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("the page shows the name and notes over the calculator, read-only, with a way into the calculator", async () => {
  const html = renderToStaticMarkup(await SharedBuildPage(params()));
  expect(html).toContain("Raid frost");
  expect(html).toContain("Two sets.\nSwap for heroics.");
  expect(html).toContain(`href="/tools/talents/mage#plan=${code}"`);
  expect(html).toContain("Open in the calculator");
  expect(html).toContain("data-calculator");
  // Read-only: no paste box, no undo, no Copy link or Save; anonymous by default; the label stays private.
  expect(html).not.toContain("talent-paste");
  expect(html).not.toContain(">Undo<");
  expect(html).not.toContain("Copy link");
  expect(html).not.toContain(">Save<");
  expect(html).not.toContain("Save a copy");
  expect(html).not.toContain("Shared by");
  expect(html).not.toContain("Jaina");
});

test("a signed-in visitor can save a copy, and the owner's name shows only when they chose it", async () => {
  auth.getUser.mockResolvedValue({ id: "11111111-2222-4333-8444-555555555555", name: "Thrall#1" });
  auth.authQuery.mockResolvedValue(shared({ owner_name: "Email owner", game_build: "1.0.0.1" }));
  const html = renderToStaticMarkup(await SharedBuildPage(params()));
  expect(html).toContain("Save a copy");
  expect(html).toContain("Shared by Email owner");
  expect(html).toContain('data-badge="files"');
});

test("the game build's badge says older only when it is older, newer when it is newer, and nothing when it is the tree's or unreadable", async () => {
  const { build } = await loadCatalog("mage");
  const parts = build.split(".");
  const older = [...parts.slice(0, -1), String(Number(parts.at(-1)) - 1)].join(".");
  const newer = [...parts.slice(0, -1), String(Number(parts.at(-1)) + 1)].join(".");
  const badges = async (gameBuild: string) => {
    auth.authQuery.mockResolvedValue(shared({ game_build: gameBuild }));
    const html = renderToStaticMarkup(await SharedBuildPage(params()));
    return [/made on an older game build/.test(html), /made on a newer game build/.test(html)];
  };
  expect(await badges(older)).toEqual([true, false]);
  // 9999 comes before 70450 as a number, though not as text.
  expect(await badges("1.0.0.9999")).toEqual([true, false]);
  expect(await badges(newer)).toEqual([false, true]);
  expect(await badges(build)).toEqual([false, false]);
  for (const junk of ["", "1.60", "1.60.x.1", "latest"]) expect(await badges(junk), junk).toEqual([false, false]);
});

test("not indexed, canonical to the class page, with the saved build's own card", async () => {
  const meta = await generateMetadata(params());
  expect(meta.robots).toEqual({ index: false, follow: true });
  expect(meta.alternates?.canonical).toBe("/tools/talents/mage");
  expect(meta.title).toBe("Raid frost · WoW Forever Mage build");
  expect(meta.description).toBe("Two sets. Swap for heroics.");
  expect((meta.openGraph as { images: { url: string }[] }).images[0].url).toBe("/tools/talents/mage/card?s=AbCd1234");
  auth.authQuery.mockResolvedValue([]);
  expect((await generateMetadata(params())).robots).toEqual({ index: false, follow: false });
});

test("the card takes the codes and the name from the database, and is never cached", async () => {
  const res = await card(new Request("https://everloot.app/tools/talents/mage/card?s=AbCd1234"), { params: Promise.resolve({ class: "mage" }) });
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(JSON.parse(auth.authQuery.mock.calls[0][1].body)).toEqual({ p_slug: "AbCd1234" });
  // With the switch off the slug is ignored: the generic class card, and no database call.
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "");
  auth.authQuery.mockClear();
  await card(new Request("https://everloot.app/tools/talents/mage/card?s=AbCd1234"), { params: Promise.resolve({ class: "mage" }) });
  expect(auth.authQuery).not.toHaveBeenCalled();
});
