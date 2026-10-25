// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ItemResult from "./ItemResult";

const CARD = {
  type: "item", id: 2589, title: "Linen Cloth", quality: 1, color: null, icon: "https://assets.everloot.app/icons/132889.webp",
  lines: ["Item Level 5", "Sell Price 13c"], foot: "Name from Warcraft Wiki + game files · unconfirmed",
};
const AS_OF = "2026-10-22T01:30:27.923Z";
const page = (over: Record<string, unknown> = {}) => ({ itemId: 2589, name: null, drops: [], pins: [], reported: { shown: [], contested: [] }, ...over });
const tool = (answer: unknown) => Response.json({ tool: "item_page", answer, text: "x".repeat(5000) });
const LINEN = [
  { type: "item", id: 2589, label: "Linen Cloth", href: "/database/items/2589", quality: 1 },
  { type: "item", id: 2996, label: "Bolt of Linen Cloth", href: "/database/items/2996", quality: 1 },
];

let container: HTMLDivElement;
let root: Root;
let urls: string[];
let signals: AbortSignal[];

function site(routes: Record<string, () => Response | Promise<Response>>) {
  urls = [];
  signals = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    if (init?.signal) signals.push(init.signal);
    for (const [prefix, answer] of Object.entries(routes)) if (url.startsWith(prefix)) return answer();
    throw new Error(`Unexpected request ${url}`);
  }));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const render = async (ui: ReactNode) => { await act(async () => root.render(ui)); await settle(); };
const text = () => container.textContent ?? "";

test("an item shows its game card, the canonical database link and published drops as observed samples", async () => {
  site({
    "/database/card/item/2589": () => Response.json({ ok: true, card: CARD }),
    "/api/tools/item_page": () => tool({ connected: true, dataAsOf: AS_OF, page: page({
      drops: [
        { sourceNpcId: 1, source: "Defias Thug", kills: 120, drops: 30, rate: 0.25, reporters: 4 },
        { sourceObjectId: 7, source: "Object 7", kills: 10, drops: 0, rate: 0, reporters: 3 },
      ],
      pendingLoot: { windows: 2, reporters: 1 },
    }) }),
  });
  await render(<ItemResult item={{ id: 2589 }} onChoose={() => {}} />);
  expect(urls).toEqual(["/database/card/item/2589", "/api/tools/item_page?itemId=2589"]);
  expect(text()).toContain("Linen Cloth");
  expect(text()).toContain("Sell Price 13c");
  expect(text()).toContain("Name from Warcraft Wiki");
  expect(container.querySelector("img")?.getAttribute("src")).toBe(CARD.icon);
  expect(container.querySelector('a[href="/database/items/2589"]')).not.toBeNull();
  expect(container.querySelector('a[href="/database/npcs/1"]')?.textContent).toBe("Defias Thug");
  expect(container.querySelector('a[href="/database/objects/7"]')?.textContent).toBe("Object 7");
  expect(text()).toContain("30 of 120 observed loot windows (25.0%), 4 reporting installs");
  expect(text()).toContain("Not seen in 10 observed loot windows, 3 reporting installs");
  expect(text()).toContain("observed samples, not the game's drop rate");
  expect(text()).toContain("2 more loot windows with this item reported, not yet in the rates.");
  expect(text()).toContain("2026-10-22");
  expect(text()).not.toContain("xxxxx");
});

test("an item with no published drops says they are not recorded yet, without naming a pending source", async () => {
  site({
    "/database/card/item/2589": () => Response.json({ ok: true, card: CARD }),
    "/api/tools/item_page": () => tool({ connected: true, dataAsOf: AS_OF, url: "https://everloot.app/database/items/2589", page: page({ pendingLoot: { windows: 1, reporters: 1 } }) }),
  });
  await render(<ItemResult item={{ id: 2589 }} onChoose={() => {}} />);
  expect(text()).toContain("No published drops yet");
  expect(text()).not.toContain("No drops recorded yet");
  expect(text()).toContain("1 more loot window with this item reported, not yet in the rates.");
  expect(container.querySelector('a[href^="/database/npcs/"]')).toBeNull();
});

test("unreachable drop data is said to be unavailable, never that the item does not drop", async () => {
  for (const answer of [
    () => tool({ connected: false, dataAsOf: null, reason: "Storage is unavailable." }),
    () => Response.json({ ok: false, error: "Knowledge release unavailable." }, { status: 503 }),
    () => Promise.reject(new Error("offline")),
  ]) {
    site({ "/database/card/item/2589": () => Response.json({ ok: true, card: CARD }), "/api/tools/item_page": answer });
    await render(<ItemResult key={Math.random()} item={{ id: 2589 }} onChoose={() => {}} />);
    expect(text()).toContain("Drop data is unavailable right now");
    expect(text()).not.toContain("No drops recorded");
  }
});

test("a missing card still links the database page; a failed one says so", async () => {
  site({ "/database/card/item/2589": () => Response.json({ ok: false }, { status: 404 }), "/api/tools/item_page": () => tool({ connected: true, dataAsOf: AS_OF, page: page() }) });
  await render(<ItemResult item={{ id: 2589 }} onChoose={() => {}} />);
  expect(container.querySelector('a[href="/database/items/2589"]')).not.toBeNull();
  expect(text()).toContain("No card for this item yet");
  site({ "/database/card/item/2589": () => Response.json({ ok: false }, { status: 503 }), "/api/tools/item_page": () => tool({ connected: true, dataAsOf: AS_OF, page: page() }) });
  await render(<ItemResult key="again" item={{ id: 2589 }} onChoose={() => {}} />);
  expect(text()).toContain("The item card is unavailable right now");
});

test("several matches are offered as buttons; choosing one hands back its id", async () => {
  site({ "/search/suggest": () => Response.json({ results: LINEN }) });
  const onChoose = vi.fn();
  await render(<ItemResult item={{ query: "Linen" }} onChoose={onChoose} />);
  const group = container.querySelector('[role="group"]');
  expect(group?.getAttribute("aria-label")).toBe("Which item did you mean?");
  const buttons = Array.from(group!.querySelectorAll("button"));
  expect(buttons.map((b) => b.textContent)).toEqual(["Linen Cloth", "Bolt of Linen Cloth"]);
  await act(async () => buttons[1].click());
  expect(onChoose).toHaveBeenCalledWith(2996);
});

test("choices that cannot load point to the search page instead", async () => {
  site({ "/search/suggest": () => Response.json({}, { status: 500 }) });
  await render(<ItemResult item={{ query: "Linen" }} onChoose={() => {}} />);
  expect(text()).toContain("No item choices could be shown right now");
  expect(container.querySelector('a[href="/search?q=Linen"]')).not.toBeNull();
});

test("leaving the answer stops its lookups", async () => {
  site({ "/database/card/item/2589": () => new Promise<Response>(() => {}), "/api/tools/item_page": () => new Promise<Response>(() => {}) });
  await render(<ItemResult item={{ id: 2589 }} onChoose={() => {}} />);
  expect(signals).toHaveLength(2);
  await act(async () => root.unmount());
  expect(signals.every((s) => s.aborted)).toBe(true);
  root = createRoot(container);
});
