import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import Breadcrumbs from "@/components/Breadcrumbs";
import { trailFor } from "./breadcrumbs";

const location = vi.hoisted(() => ({ path: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => location.path, notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/components/chat/ChatClient", () => ({ default: () => <div /> }));
vi.mock("@/lib/game-assets", () => ({ loadSiteAssets: async () => null, classAndProfessionIcons: () => ({ classes: [], professions: [] }) }));

afterEach(() => vi.unstubAllEnvs());

test("the player search, hide forms and chat serve one shared trail and a WebPage", async () => {
  vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
  vi.stubEnv("EVERLOOT_GUILDS", "1");
  const { default: Players } = await import("@/app/players/page");
  const { default: OptOut } = await import("@/app/players/opt-out/page");
  const { default: HideGuild } = await import("@/app/guilds/hide/page");
  const { default: Chat } = await import("@/app/chat/page");
  const props = () => ({ searchParams: Promise.resolve({}) });
  for (const [path, page] of [
    ["/players", () => Players(props())], ["/players/opt-out", () => OptOut(props())],
    ["/guilds/hide", () => HideGuild(props())], ["/chat", () => Chat()],
  ] as const) {
    location.path = path;
    const html = renderToStaticMarkup(<><Breadcrumbs />{await page()}</>);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
    const trails = blocks.filter((block) => block["@type"] === "BreadcrumbList");
    expect(trails, path).toHaveLength(1);
    expect(trails[0].itemListElement.map((item: { name: string }) => item.name)).toEqual(trailFor(path)!.map((crumb) => crumb.name));
    expect(blocks.filter((block) => block["@type"] === "WebPage"), path).toMatchObject([{ url: `https://everloot.app${path}` }]);
  }
});
