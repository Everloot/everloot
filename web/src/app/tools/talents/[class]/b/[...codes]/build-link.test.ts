import { beforeEach, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
const cards = vi.hoisted(() => ({
  renderBuildCard: vi.fn(async () => new Response("build card")),
  renderCard: vi.fn(async () => new Response("class card")),
}));
vi.mock("@/lib/og-card", () => cards);

import TalentBuildPage, { generateMetadata } from "./page";
import { GET as card } from "@/app/tools/talents/[class]/card/route";
import { loadCatalog } from "@/lib/talents/catalogs";
import { encodeBuild } from "@/lib/talents/share";

// A build link's path, and the card its preview asks for, take each segment as a whole code, as the calculator does.
// A segment with a link's code inside it is a bad code, so it gets what any bad code gets: a 404 page with no preview,
// and the class's own card.

let code = "";
const page = (codes: string[]) => ({ params: Promise.resolve({ class: "mage", codes }) });
const cardFor = (a: string) => card(new Request(`https://everloot.app/tools/talents/mage/card?a=${encodeURIComponent(a)}`), { params: Promise.resolve({ class: "mage" }) });

beforeEach(async () => {
  const catalog = await loadCatalog("mage");
  const first = catalog.nodes.find((n) => !n.unlock && n.prereqs.length === 0 && !n.anyOf)!;
  code = encodeBuild({ classSlug: "mage", specId: 0, build: catalog.build, ranks: { [first.id]: { rank: 1 } } });
  cards.renderBuildCard.mockClear();
  cards.renderCard.mockClear();
});

test("a segment with a link's code inside it is a 404 with no preview, as any bad code is", async () => {
  expect((await generateMetadata(page([code]))).title).toContain("WoW Forever talent build");
  for (const segment of [`junk%23plan=${code}`, "junk"]) {
    await expect(TalentBuildPage(page([segment])), segment).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await generateMetadata(page([segment])), segment).toEqual({});
  }
});

test("its card is the class's own picture, as any bad code's is, not the build's", async () => {
  await cardFor(code);
  expect(cards.renderBuildCard).toHaveBeenCalledOnce();
  for (const value of [`junk%23plan=${code}`, "junk"]) {
    cards.renderBuildCard.mockClear();
    cards.renderCard.mockClear();
    await cardFor(value);
    expect(cards.renderBuildCard, value).not.toHaveBeenCalled();
    expect(cards.renderCard, value).toHaveBeenCalledOnce();
  }
});
