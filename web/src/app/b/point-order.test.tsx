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

import SharedBuildPage from "./[slug]/page";
import { GET as card } from "@/app/tools/talents/[class]/card/route";
import { loadCatalog } from "@/lib/talents/catalogs";
import { encodeBuild, encodeOrder } from "@/lib/talents/share";

// A saved build's short link with each set's spend order. The page reads what is public through shared_build, and
// the orders beside it for that build only: still shared, with the same codes.

const OWNER = "11111111-2222-4333-8444-555555555555";
const ORDER_READ = "saved_builds?select=code,code2,point_order,point_order2&slug=eq.AbCd1234&shared=is.true&limit=1";
let code = "";
let code2 = "";
let order = "";
let order2 = "";
/** What shared_build answers, and what the read of the orders beside it answers. */
let publicRows: object[] = [];
let orderRows: object[] = [];
const shared = (over: object = {}) => ({
  name: "Raid frost", notes: null, class_slug: "mage", code, code2, game_build: "", character_name: "Jaina", character_class: "mage",
  owner_name: null, updated_at: "2026-10-20T12:00:00+00:00", ...over,
});
const params = (slug = "AbCd1234") => ({ params: Promise.resolve({ slug }) });
const paths = () => auth.authQuery.mock.calls.map(([path]) => path as string);

beforeEach(async () => {
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "1");
  const catalog = await loadCatalog("mage");
  const [first, second] = catalog.nodes.filter((n) => !n.unlock && n.prereqs.length === 0 && !n.anyOf);
  code = encodeBuild({ classSlug: "mage", specId: 0, build: catalog.build, ranks: { [first.id]: { rank: 1 } } });
  code2 = encodeBuild({ classSlug: "mage", specId: 0, build: catalog.build, ranks: { [second.id]: { rank: 1 } } });
  order = encodeOrder({ [first.id]: { rank: 1 } }, [first.id], "planned")!;
  order2 = encodeOrder({ [second.id]: { rank: 1 } }, [second.id], "provisional")!;
  publicRows = [shared({ game_build: catalog.build })];
  orderRows = [{ code, code2, point_order: order, point_order2: order2 }];
  auth.getUser.mockReset().mockResolvedValue(null);
  auth.authQuery.mockReset().mockImplementation(async (path: string) => {
    if (path === "rpc/shared_build") return publicRows;
    if (path.startsWith("saved_builds?")) return orderRows;
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(() => { vi.unstubAllEnvs(); });

test("the page opens the calculator with both sets and both spend orders, each with its maker's letter", async () => {
  expect([order.slice(0, 4), order2.slice(0, 4)]).toEqual(["O1p-", "O1g-"]);
  const html = renderToStaticMarkup(await SharedBuildPage(params()));
  expect(html).toContain(`href="/tools/talents/mage#plan=${code}&amp;plan2=${code2}&amp;order=${order}&amp;order2=${order2}"`);
  // The orders are read for this build only, and only while it is shared.
  expect(paths()).toEqual(["rpc/shared_build", ORDER_READ]);
});

test("a build saved before orders, or with them unknown, opens as it always did", async () => {
  orderRows = [{ code, code2, point_order: null, point_order2: null }];
  expect(renderToStaticMarkup(await SharedBuildPage(params()))).toContain(`href="/tools/talents/mage#plan=${code}&amp;plan2=${code2}"`);
});

test("an order is never shown with codes it was not saved with: a build changed between the two reads opens without them", async () => {
  // The owner saved new talents between the public read and the read of the orders, which now belong to those.
  orderRows = [{ code: code2, code2: null, point_order: order2, point_order2: null }];
  const html = renderToStaticMarkup(await SharedBuildPage(params()));
  expect(html).toContain(`href="/tools/talents/mage#plan=${code}&amp;plan2=${code2}"`);
  expect(html).not.toContain("order=");
  // Sharing turned off in between: the page shows what was public a moment ago, with no orders.
  orderRows = [];
  expect(renderToStaticMarkup(await SharedBuildPage(params()))).not.toContain("order=");
});

test("an unshared, deleted or unknown build is the same 404 as before, and its orders are never read", async () => {
  publicRows = [];
  await expect(SharedBuildPage(params())).rejects.toThrow("NEXT_NOT_FOUND");
  expect(paths()).toEqual(["rpc/shared_build"]);
  auth.authQuery.mockClear();
  await expect(SharedBuildPage(params("../../x"))).rejects.toThrow("NEXT_NOT_FOUND");
  expect(auth.authQuery).not.toHaveBeenCalled();
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "");
  await expect(SharedBuildPage(params())).rejects.toThrow("NEXT_NOT_FOUND");
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("with orders on the page, the character label, the BattleTag and every id still stay off it and off its card", async () => {
  auth.getUser.mockResolvedValue({ id: OWNER, name: "Thrall#1234" });
  publicRows = [shared({ character_name: "Jaina", owner_name: null })];
  const html = renderToStaticMarkup(await SharedBuildPage(params()));
  expect(html).toContain(order);
  for (const hidden of ["Jaina", "Thrall#1234", OWNER, "Shared by"]) expect(html).not.toContain(hidden);
  // The card reads the same two things and is never cached; it draws the name and the codes, nothing of the account.
  auth.authQuery.mockClear();
  const res = await card(new Request("https://everloot.app/tools/talents/mage/card?s=AbCd1234"), { params: Promise.resolve({ class: "mage" }) });
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(paths()).toEqual(["rpc/shared_build", ORDER_READ]);
});

test("a signed-in visitor's Save a copy is given both sets' orders to copy", async () => {
  auth.getUser.mockResolvedValue({ id: OWNER, name: "Thrall#1234" });
  const page = await SharedBuildPage(params());
  // SaveCopy is a client component: what it is handed is what it posts (copy-orders.test.tsx).
  const copy = findElement(page, (el) => typeof el.type === "function" && el.type.name === "SaveCopy");
  expect(copy?.props).toMatchObject({ name: "Raid frost", code, code2, order, order2 });
});

type Element = { type: unknown; props: Record<string, unknown> };
/** The first element in a rendered tree that `match` picks, through children and every prop that holds elements. */
function findElement(node: unknown, match: (el: Element) => boolean): Element | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, match);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return null;
  const el = node as Element;
  if (match(el)) return el;
  for (const value of Object.values(el.props)) {
    const found = findElement(value, match);
    if (found) return found;
  }
  return null;
}
