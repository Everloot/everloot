import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import GameIcon, { UNKNOWN_ITEM_ICON } from "./GameIcon";
import { EntityIcon } from "@/app/database/entity";
import { QUALITIES } from "@/design/tokens";

test("every item quality has a solid one-pixel icon border; non-items keep their border", () => {
  for (const quality of QUALITIES) {
    const html = renderToStaticMarkup(<GameIcon src="/icon.webp" quality={quality} />);
    expect(html).toContain(`border-q-${quality}`);
    expect(html).not.toContain("border-[#3d3a2e]");
    expect(html).toMatch(/ border /);
  }
  expect(renderToStaticMarkup(<GameIcon src="/spell.webp" />)).toContain("border-[#3d3a2e]");
});

test("a missing item icon uses the game's question mark and keeps quality without a dashed tile", () => {
  const html = renderToStaticMarkup(<EntityIcon quality="rare" unconfirmed />);
  expect(html).toContain(UNKNOWN_ITEM_ICON);
  expect(html).toContain("border-q-rare");
  expect(html).not.toContain("border-dashed");
  expect(html).toContain("unconfirmed");
});
