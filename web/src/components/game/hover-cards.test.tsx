// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import HoverCards, { CARD_ID, forgetCards, SHOW_DELAY } from "./HoverCards";

const THUNDERFURY = {
  type: "item", id: 19019, title: "Thunderfury, Blessed Blade of the Windseeker", quality: 5,
  icon: "https://assets.everloot.app/b/icons/1.webp", lines: ["Binds when picked up", "+[?] Agility"],
  foot: "Name from the Warcraft Wiki · Found in game files, unconfirmed · build 70450",
};

let container: HTMLDivElement;
let root: Root;
let fetcher: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  forgetCards();
  fetcher = vi.fn(async (url: string) => (url.endsWith("/item/19019")
    ? new Response(JSON.stringify({ ok: true, card: THUNDERFURY }), { status: 200 })
    : new Response(JSON.stringify({ ok: false }), { status: 404 })));
  vi.stubGlobal("fetch", fetcher);
  container = document.createElement("div");
  container.innerHTML = '<a href="/database/items/19019">Thunderfury</a> <a href="/database/items/99999">Item 99999</a> <a href="/lore/1-thrall">Thrall</a>';
  document.body.append(container);
  const mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  await act(async () => root.render(<HoverCards />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const link = (href: string) => container.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)!;
const card = () => document.querySelector<HTMLElement>("[data-hover-card]");
/** A pointer event; jsdom may lack PointerEvent, so the type is set on a mouse event. */
function pointer(type: string, target: Element, pointerType = "mouse", relatedTarget: Element | null = null) {
  const e = new MouseEvent(type, { bubbles: true, clientX: 40, clientY: 20, relatedTarget });
  Object.defineProperty(e, "pointerType", { value: pointerType });
  target.dispatchEvent(e);
}
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

test("resting the pointer on an item link shows the in-game card: icon, name in its quality colour, the game's lines and where they come from", async () => {
  pointer("pointerover", link("/database/items/19019"));
  await wait(SHOW_DELAY - 10);
  expect(fetcher).not.toHaveBeenCalled();
  expect(card()).toBeNull();
  await wait(20);
  expect(fetcher).toHaveBeenCalledWith("/database/card/item/19019", expect.anything());
  const shown = card()!;
  expect(shown.getAttribute("role")).toBe("tooltip");
  expect(shown.querySelector("[data-tooltip-frame]")).not.toBeNull();
  expect(shown.querySelector("img")!.getAttribute("src")).toBe(THUNDERFURY.icon);
  const name = shown.querySelector("[data-tooltip-frame] p")!;
  expect(name.textContent).toBe(THUNDERFURY.title);
  expect(name.className).toContain("text-q-legendary");
  expect(shown.textContent).toContain("Binds when picked up");
  expect(shown.textContent).toContain("+[?] Agility");
  expect(shown.textContent).toContain("Name from the Warcraft Wiki");
  // The card describes the link while it is open.
  expect(link("/database/items/19019").getAttribute("aria-describedby")).toBe(CARD_ID);

  pointer("pointerout", link("/database/items/19019"), "mouse", document.body);
  await wait(0);
  expect(card()).toBeNull();
  expect(link("/database/items/19019").hasAttribute("aria-describedby")).toBe(false);
  // Asked once per page for the visit.
  pointer("pointerover", link("/database/items/19019"));
  await wait(SHOW_DELAY);
  expect(card()).not.toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("an id nobody reported (404) gets no card, and is not asked for again", async () => {
  pointer("pointerover", link("/database/items/99999"));
  await wait(SHOW_DELAY);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(card()).toBeNull();
  pointer("pointerout", link("/database/items/99999"), "mouse", document.body);
  pointer("pointerover", link("/database/items/99999"));
  await wait(SHOW_DELAY);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(card()).toBeNull();
});

test("keyboard focus shows the card and Escape hides it, with focus left on the link", async () => {
  const a = link("/database/items/19019");
  await act(async () => a.focus());
  await wait(SHOW_DELAY);
  expect(card()).not.toBeNull();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(0);
  expect(card()).toBeNull();
  expect(document.activeElement).toBe(a);
});

test("a pointer that leaves before the delay asks for nothing; touch, other pages and links with their own card get none", async () => {
  pointer("pointerover", link("/database/items/19019"));
  await wait(50);
  pointer("pointerout", link("/database/items/19019"), "mouse", document.body);
  await wait(SHOW_DELAY);
  expect(fetcher).not.toHaveBeenCalled();

  pointer("pointerover", link("/database/items/19019"), "touch");
  pointer("pointerover", link("/lore/1-thrall"));
  await wait(SHOW_DELAY);
  expect(fetcher).not.toHaveBeenCalled();

  const own = document.createElement("span");
  own.setAttribute("data-item-tip", "");
  own.innerHTML = '<a href="/database/items/19019">Thunderfury</a>';
  container.append(own);
  pointer("pointerover", own.querySelector("a")!);
  await wait(SHOW_DELAY);
  expect(fetcher).not.toHaveBeenCalled();
  expect(card()).toBeNull();
});

test("the scroll that focus causes does not close the card; it still closes a card the pointer opened", async () => {
  const a = link("/database/items/19019");
  await act(async () => a.focus());
  window.dispatchEvent(new Event("scroll"));
  await wait(SHOW_DELAY);
  expect(card()).not.toBeNull();
  expect(a.getAttribute("aria-describedby")).toBe(CARD_ID);
  window.dispatchEvent(new Event("scroll"));
  await wait(0);
  expect(card()).not.toBeNull();
  await act(async () => a.blur());
  await wait(0);
  expect(card()).toBeNull();
  expect(a.hasAttribute("aria-describedby")).toBe(false);

  pointer("pointerover", a);
  await wait(SHOW_DELAY);
  expect(card()).not.toBeNull();
  window.dispatchEvent(new Event("scroll"));
  await wait(0);
  expect(card()).toBeNull();
});

test("the icon sits inside the frame beside the name, and the footnote shows only while a line holds [?]", async () => {
  const NOTE = "[?] in a Use, Equip or Chance on hit line: a value the spell tables we read do not give.";
  const open = async (c: object) => {
    forgetCards();
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ ok: true, card: c }), { status: 200 }));
    await act(async () => link("/database/items/19019").focus());
    await wait(SHOW_DELAY);
    return card()!;
  };
  const shown = await open({ ...THUNDERFURY, notes: [NOTE] });
  const frame = shown.querySelector("[data-tooltip-frame]")!;
  expect(frame.contains(shown.querySelector("img"))).toBe(true);
  expect(shown.querySelector("img")!.getAttribute("width")).toBe("48");
  const notes = shown.querySelector("[data-card-notes]")!;
  expect(notes.textContent).toBe(NOTE);
  expect(frame.contains(notes)).toBe(false);

  await act(async () => link("/database/items/19019").blur());
  const clean = await open({ ...THUNDERFURY, lines: ["Binds when picked up"], notes: [NOTE] });
  expect(clean.querySelector("[data-card-notes]")).toBeNull();
});
