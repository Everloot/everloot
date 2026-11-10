import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import GameIcon from "./GameIcon";
import { EntityIcon } from "@/app/database/entity";
import { QUALITIES } from "@/design/tokens";
import { unknownItemIcon } from "@/lib/game-assets";

test("every item quality has a solid one-pixel icon border; non-items keep their border", () => {
  for (const quality of QUALITIES) {
    const html = renderToStaticMarkup(<GameIcon src="/icon.webp" quality={quality} />);
    expect(html).toContain(`border-q-${quality}`);
    expect(html).not.toContain("border-[#3d3a2e]");
    expect(html).toMatch(/ border /);
  }
  expect(renderToStaticMarkup(<GameIcon src="/spell.webp" />)).toContain("border-[#3d3a2e]");
});

test("an item header icon keeps its quality without a dashed tile; with no icon (no asset files) it draws nothing", () => {
  const fallback = unknownItemIcon("https://assets.example.test/b");
  expect(fallback).toBe("https://assets.example.test/b/icons/134400.webp");
  const html = renderToStaticMarkup(<EntityIcon item src={fallback} quality="rare" unconfirmed />);
  expect(html).toContain(fallback);
  expect(html).toContain("border-q-rare");
  expect(html).not.toContain("border-dashed");
  expect(html).toContain("unconfirmed");
  expect(renderToStaticMarkup(<EntityIcon item quality="rare" unconfirmed />)).toBe("");
});
