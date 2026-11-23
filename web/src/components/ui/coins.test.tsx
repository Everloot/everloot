// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import Coins, { CoinText, MoneyText } from "./Coins";

test.each([
  [21894, "2 gold 18 silver 94 copper", 3],
  [0, "0 copper", 1],
  [10000, "1 gold 0 silver 0 copper", 3],
  [-110, "minus 1 silver 10 copper", 2],
] as const)("%s copper keeps an accessible price and fixed-size decorative coins", (copper, spoken, count) => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(<Coins copper={copper} />);
  expect(root.querySelector(".sr-only")?.textContent).toBe(spoken);
  expect(root.querySelectorAll('svg[aria-hidden="true"][width="12"][height="12"]')).toHaveLength(count);
  expect(root.querySelectorAll("linearGradient, radialGradient")).toHaveLength(0);
  // The metal reads without the colour: each coin carries its letter.
  const letters = [...root.querySelectorAll("svg text")].map((t) => t.textContent);
  expect(letters).toEqual(spoken.split(" ").filter((w) => ["gold", "silver", "copper"].includes(w)).map((m) => m[0]));
});

test("large gold amounts group their thousands", () => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(<Coins copper={12_345_678_901} />);
  expect(root.querySelector('[aria-hidden="true"]')?.textContent).toBe("1,234,567g 89s 1c");
  expect(root.querySelector(".sr-only")?.textContent).toBe("1,234,567 gold 89 silver 1 copper");
  root.innerHTML = renderToStaticMarkup(<Coins copper={9_999_0000} />);
  expect(root.querySelector('[aria-hidden="true"]')?.textContent).toBe("9,999g 0s 0c");
  root.innerHTML = renderToStaticMarkup(<Coins copper={999_0000} />);
  expect(root.querySelector('[aria-hidden="true"]')?.textContent).toBe("999g 0s 0c");
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
  expect(root.querySelectorAll("svg")).toHaveLength(4);
});
