// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Coins, { CoinSprite, CoinText, MoneyText } from "./Coins";

test.each([
  [21894, "2 gold 18 silver 94 copper", 3],
  [0, "0 copper", 1],
  [10000, "1 gold", 1],
  [200, "2 silver", 1],
  [10005, "1 gold 5 copper", 2],
  [-110, "minus 1 silver 10 copper", 2],
] as const)("%s copper keeps an accessible price and fixed-size decorative coins", (copper, spoken, count) => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(<Coins copper={copper} />);
  expect(root.querySelector(".sr-only")?.textContent).toBe(spoken);
  // Each coin points at its metal's drawing in the page's one sprite (the 12 px size is the .coin class).
  const coins = [...root.querySelectorAll('svg[aria-hidden="true"].coin > use')].map((u) => u.getAttribute("href"));
  expect(coins).toEqual(spoken.split(" ").filter((w) => ["gold", "silver", "copper"].includes(w)).map((m) => `#coin-${m[0]}`));
  expect(coins).toHaveLength(count);
  expect(root.querySelectorAll("circle, text")).toHaveLength(0);
});

test("a price's coins cost a few dozen bytes each, not a drawing per coin", () => {
  // 2g 18s 94c: the spoken price, the shown digits and three coin references.
  expect(renderToStaticMarkup(<Coins copper={21894} />).length).toBeLessThan(400);
});

test("the sprite draws each metal once: its colour, its letter in the tooltip ink, no gradient", () => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(<CoinSprite />);
  const sprite = root.firstElementChild!;
  expect(sprite.getAttribute("aria-hidden")).toBe("true");
  const symbols = [...sprite.querySelectorAll("symbol")];
  expect(symbols.map((s) => s.id)).toEqual(["coin-g", "coin-s", "coin-c"]);
  for (const [s, metal] of symbols.map((s, i) => [s, ["gold", "silver", "copper"][i]] as const)) {
    expect(s.getAttribute("viewBox")).toBe("0 0 12 12");
    expect(s.querySelector("circle")?.getAttribute("style")).toBe(`fill:rgb(var(--coin-${metal}))`);
    // The metal reads without the colour: each coin carries its letter.
    expect(s.querySelector("text")?.textContent).toBe(metal[0]);
    expect(s.querySelector("text")?.getAttribute("style")).toBe("fill:rgb(var(--tooltip))");
  }
  expect(root.querySelectorAll("linearGradient, radialGradient")).toHaveLength(0);
});

test("every page carries the sprite: the root layout draws it, the stylesheet sizes the coins", () => {
  const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
  expect(read("../../app/layout.tsx")).toMatch(/<CoinSprite \/>/);
  const css = read("../../app/globals.css");
  expect(css).toMatch(/\.coin \{[^}]*width: 12px;[^}]*height: 12px;/);
});

test("large gold amounts group their thousands", () => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(<Coins copper={12_345_678_901} />);
  // The coins' letters are in the sprite, so the shown text is the grouped digits between the coins.
  expect(root.querySelector('[aria-hidden="true"]')?.textContent).toBe("1,234,567 89 1");
  expect(root.querySelector(".sr-only")?.textContent).toBe("1,234,567 gold 89 silver 1 copper");
  root.innerHTML = renderToStaticMarkup(<Coins copper={9_999_0000} />);
  expect(root.querySelector('[aria-hidden="true"]')?.textContent).toBe("9,999");
  root.innerHTML = renderToStaticMarkup(<Coins copper={999_0000} />);
  expect(root.querySelector('[aria-hidden="true"]')?.textContent).toBe("999");
});

test("a formatted price leaves out a zero coin below the largest, as the game prints it", () => {
  const root = document.createElement("div");
  for (const [text, spoken, shown] of [["2s 0c", "2 silver", "2"], ["1g 0s 5c", "1 gold 5 copper", "1 5"], ["0c", "0 copper", "0"], ["-3g 0s 0c", "minus 3 gold", "-3"]] as const) {
    root.innerHTML = renderToStaticMarkup(<CoinText text={text} />);
    expect(root.querySelector(".sr-only")?.textContent, text).toBe(spoken);
    expect(root.querySelector('[aria-hidden="true"]')?.textContent, text).toBe(shown);
  }
});

test("unknown and unavailable amounts remain text", () => {
  expect(renderToStaticMarkup(<Coins copper={null} />)).toBe("unrecorded");
  expect(renderToStaticMarkup(<CoinText text="unavailable" />)).toBe("unavailable");
});

test("a published ledger answer keeps its words and shows money as coins", () => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(<MoneyText text={"Peak: 1g 2s 3c\nNet: -4c"} />);
  expect([...root.querySelectorAll(".sr-only")].map((el) => el.textContent)).toEqual(["1 gold 2 silver 3 copper", "minus 4 copper"]);
  expect(root.textContent).toContain("Peak:");
  expect(root.querySelectorAll("svg.coin")).toHaveLength(4);
});
