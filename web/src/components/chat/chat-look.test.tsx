import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import ChatWelcome, { WELCOME } from "./ChatWelcome";
import { AssistantMessage, pageKind } from "./Message";

const ICON = "https://assets.everloot.app/b/icons/warrior.webp";

test("the empty chat welcomes with a heading, a decorative Glint and four question cards", () => {
  const html = renderToStaticMarkup(<ChatWelcome disabled={false} onAsk={() => {}} />);
  expect(html).toMatch(/<h2 [^>]*>Ask anything\.<br\/><span class="text-accent">See where it comes from\.<\/span><\/h2>/);
  expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
  const cards = [...html.matchAll(/<button type="button"[^>]*>([\s\S]*?)<\/button>/g)];
  expect(cards).toHaveLength(WELCOME.length);
  // Each card's name is its question alone: the icon is hidden from screen readers.
  for (const [i, c] of cards.entries()) {
    let name = c[1];
    for (let prev = ""; prev !== name;) { prev = name; name = name.replace(/<[^>]*>/g, ""); }
    expect(name).toBe(WELCOME[i].text);
  }
});

test("a card shows the game icon when the page has one, and the drawn glyph without it", () => {
  const withIcon = renderToStaticMarkup(<ChatWelcome icons={{ warrior: ICON }} disabled={false} onAsk={() => {}} />);
  expect(withIcon).toContain(`src="${ICON}"`);
  expect(withIcon.match(/data-game-icon/g)).toHaveLength(1);
  const without = renderToStaticMarkup(<ChatWelcome disabled={false} onAsk={() => {}} />);
  expect(without).not.toContain("data-game-icon");
});

test("an answer's pages are source cards that say what each page is; cited sources say they open a new tab", () => {
  const html = renderToStaticMarkup(
    <AssistantMessage copied={false} onCopy={() => {}} m={{
      role: "assistant", text: "Humanoids drop it.", at: "", model: "m", steps: [],
      pages: ["https://everloot.app/database/item/2589", "https://everloot.app/database/npcs/1"],
      sources: ["https://warcraft.wiki.gg/wiki/Linen_Cloth (CC-BY-SA-4.0, retrieved 2023-11-13)"],
    }} />,
  );
  const list = html.match(/<ul aria-label="Sources"[\s\S]*?<\/ul>/)?.[0] ?? "";
  expect(list).toMatch(/<a href="https:\/\/everloot.app\/database\/item\/2589"[^>]*><span[^>]*>Item<\/span> <span[^>]*>\/database\/item\/2589<\/span>/);
  expect(list).toContain(">NPC<");
  expect(list).toMatch(/target="_blank" rel="noopener noreferrer"[^>]*><span[^>]*>Cited<span class="sr-only"> \(opens in a new tab\)<\/span>/);
});

test("a page's kind comes from its path", () => {
  expect(pageKind("/database/items/2589")).toBe("Item");
  expect(pageKind("/database/quest/12")).toBe("Quest");
  expect(pageKind("/lore/thrall")).toBe("Lore");
  expect(pageKind("/changes")).toBe("Change");
  expect(pageKind("/about")).toBe("Page");
});
