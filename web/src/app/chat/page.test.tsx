import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// The server page only: the client bundle is stood in for by its props, so this reads what the page hands it.
const assets = vi.hoisted(() => ({
  loadSiteAssets: vi.fn(),
  classAndProfessionIcons: vi.fn(),
}));
vi.mock("@/lib/game-assets", () => assets);
vi.mock("@/components/chat/ChatClient", () => ({
  default: (props: Record<string, unknown>) => <div data-chat-client={JSON.stringify(props)} />,
}));

import ChatPage, { metadata } from "./page";
import { absoluteUrl } from "@/lib/seo";

const ASSET = "https://assets.everloot.app/icons/class-1.webp";
const icons = (warrior: string | null) => ({ classes: warrior ? [{ key: "warrior", name: "Class 1", icon: warrior }] : [], professions: [] });

const render = async () => renderToStaticMarkup(await ChatPage());
/** The props the page gave the chat client. */
const clientProps = (html: string) => {
  const raw = /data-chat-client="([^"]*)"/.exec(html)?.[1];
  expect(raw).toBeDefined();
  return JSON.parse(raw!.replaceAll("&quot;", '"').replaceAll("&amp;", "&")) as Record<string, unknown>;
};

beforeEach(() => {
  assets.loadSiteAssets.mockResolvedValue({ base: "https://assets.everloot.app/x" });
  assets.classAndProfessionIcons.mockReturnValue(icons(ASSET));
  for (const name of ["EVERLOOT_SAVED_BUILDS", "EVERLOOT_PROFILES", "EVERLOOT_CHAT_WORKSPACE"]) vi.stubEnv(name, "");
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

test("the page is titled Ask Everloot, canonical at /chat, with a WebPage record at that address", async () => {
  expect(metadata.title).toBe("Ask Everloot");
  expect(metadata.alternates?.canonical).toBe("/chat");
  const html = await render();
  expect(html).toContain('<h1 class="sr-only">Ask Everloot</h1>');
  expect(html).toContain('"@type":"WebPage"');
  expect(html).toContain(`"url":"${absoluteUrl("/chat")}"`);
});

test("the suggestion icon comes from the asset bucket only; another host's address is dropped", async () => {
  expect(clientProps(await render()).icons).toEqual({ warrior: ASSET });
  assets.classAndProfessionIcons.mockReturnValue(icons("https://elsewhere.example/icons/class-1.webp"));
  expect(clientProps(await render()).icons).toEqual({});
});

test("with the asset manifest unreachable the chat still renders, without the icon", async () => {
  assets.loadSiteAssets.mockResolvedValue(null);
  assets.classAndProfessionIcons.mockReturnValue(icons(null));
  const html = await render();
  expect(assets.classAndProfessionIcons).toHaveBeenCalledWith(null);
  expect(html).toContain("Ask Everloot");
  expect(clientProps(html).icons).toEqual({});
});

test("the switches the client gets are off by default and follow their variables", async () => {
  const off = clientProps(await render());
  expect(off).toMatchObject({ savedBuilds: false, profiles: false, workspace: false });
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "1");
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  vi.stubEnv("EVERLOOT_CHAT_WORKSPACE", "1");
  expect(clientProps(await render())).toMatchObject({ savedBuilds: true, profiles: true, workspace: true });
});
