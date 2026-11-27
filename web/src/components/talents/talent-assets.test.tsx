// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CREDIT } from "@/lib/talents/assets";
import { fixture } from "@/lib/talents/fixture";
import type { TalentCatalog } from "@/lib/talents/types";
import TalentCalculator from "./TalentCalculator";

const BASE = "https://assets.example.test/b";
// The fixture with definition ids, so the manifest can name its entries.
const catalog: TalentCatalog = {
  ...fixture,
  nodes: fixture.nodes.map((n) => ({ ...n, entries: n.entries.map((e, i) => ({ ...e, definitionId: n.id * 10 + i })) })),
};
const file = (name: string) => ({ file: name, width: 50, height: 50, bytes: 1, sha256: "0".repeat(64) });
const spells = Object.fromEntries(catalog.nodes.flatMap((n) => n.entries.map((e) => [
  String(e.definitionId),
  { spellId: 1, name: e.name, icon: `${e.definitionId}.webp`, passive: n.id % 2 === 0, description: { text: `Text of ${e.name}.`, unresolved: [] } },
])));
const frames = Object.fromEntries(["circle", "square"].flatMap((s) => ["gray", "green", "yellow"].map((st) => [`talents-node-${s}-${st}`, file(`frames/talents-node-${s}-${st}.webp`)])));
const manifest = {
  schema: "everloot.game-assets/1", label: "found in game files, unconfirmed",
  build: { product: "p", buildId: 1, version: "9.9.9.1", buildConfig: "c", extractedAt: "2026-10-18T00:00:00.000Z" },
  spells, icons: {}, frames, backgrounds: {},
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.location.hash = "";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const render = () => act(async () => root.render(<TalentCalculator catalog={catalog} />));
const node = (id: number) => container.querySelector<HTMLButtonElement>(`#talent-${id}`)!;
const tooltip = () => document.querySelector("[data-talent-tooltip]");

test("without the asset URL the page is the text tiles: no fetch, no credit, no tooltip", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await render();
  expect(fetcher).not.toHaveBeenCalled();
  expect(container.querySelector("[data-game-look]")).toBeNull();
  expect(container.textContent).not.toContain("Blizzard");
  await act(async () => { node(11).dispatchEvent(new FocusEvent("focusin", { bubbles: true })); node(11).focus(); });
  expect(tooltip()).toBeNull();
  expect(node(11).textContent).toContain("Talent 11");
});

test("a manifest that fails to load leaves the text tiles and raises no error", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", BASE);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  await render();
  expect(container.querySelector("[data-game-look]")).toBeNull();
  expect(container.textContent).not.toContain("Blizzard");
  expect(node(11).textContent).toContain("Talent 11");
  expect(errors).not.toHaveBeenCalled();
});

test("with a good manifest: frames, icons, state colours, rank counters, tooltip and the credit", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", BASE);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(manifest)));
  await render();
  expect(container.querySelectorAll("[data-game-look]").length).toBeGreaterThan(0);

  // No credit block in the calculator: the credit is site-wide (footer and /methodology#credits).
  expect(container.querySelector("[data-game-credit]")).toBeNull();
  expect(container.textContent).not.toContain(CREDIT);

  // Open node is green, a locked one grey; passive (even id) is square, active round.
  expect(node(11).dataset.state).toBe("green");
  expect(node(21).dataset.state).toBe("gray");
  expect(node(12).dataset.shape).toBe("square");
  expect(node(11).dataset.shape).toBe("circle");
  expect(node(11).innerHTML).toContain(`${BASE}/frames/talents-node-circle-green.webp`);
  expect(node(11).innerHTML).toContain(`${BASE}/icons/110.webp`);
  // Rank counter shows for a multi-rank talent, and the state is still in the accessible name.
  expect(node(11).textContent).toContain("0/5");
  expect(node(11).getAttribute("aria-label")).toBe("Talent 11, rank 0 of 5, row 1, can take a point");

  // Taking points: partial stays green, full turns gold.
  for (let i = 0; i < 5; i++) await act(async () => { node(11).click(); });
  expect(node(11).dataset.state).toBe("yellow");
  expect(node(11).innerHTML).toContain("talents-node-circle-yellow.webp");
});

test("the tooltip shows on focus and on hover, says the text, and Escape closes it", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", BASE);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(manifest)));
  await render();

  await act(async () => { node(11).focus(); });
  expect(tooltip()?.textContent).toContain("Talent 11");
  expect(tooltip()?.textContent).toContain("Text of Talent 11.");
  expect(tooltip()?.textContent).toContain("found in game files, unconfirmed");
  await act(async () => { node(11).blur(); });
  expect(tooltip()).toBeNull();

  await act(async () => { node(21).dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })); node(21).dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" })); });
  expect(tooltip()?.textContent).toContain("Needs 5 points spent in Left");

  await act(async () => { node(21).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(tooltip()).toBeNull();
});

test("a long press on a touch screen shows the tooltip and does not take a point back", async () => {
  vi.useFakeTimers();
  try {
    vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", BASE);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(manifest)));
    await render();
    await act(async () => { node(11).click(); });
    expect(node(11).textContent).toContain("1/5");
    await act(async () => { node(11).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" })); });
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(tooltip()?.textContent).toContain("Text of Talent 11.");
    expect(node(11).textContent).toContain("1/5");
  } finally {
    vi.useRealTimers();
  }
});

test("every node carries its tooltip text for a screen reader, without hover", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", BASE);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(manifest)));
  await render();
  const id = node(11).getAttribute("aria-describedby")!;
  expect(document.getElementById(id)?.textContent).toBe("Talent 11. Text of Talent 11.");
});

test("the tooltip follows the rank: a talent's own rank, a Next rank line, and a note where the files hold no per-rank amount", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", BASE);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(manifest)));
  await render();
  const tip = () => tooltip()?.textContent ?? "";
  const focus = (id: number) => act(async () => { node(id).blur(); node(id).focus(); });

  // A five-rank talent whose amount per rank is not in the files: no Next rank before the first point or at full rank,
  // a Next rank line between, and the note every time.
  await focus(11);
  expect(tip()).toContain("Rank 0/5");
  expect(tip()).not.toContain("Next rank:");
  expect(tip()).toContain("not in the game files we read");
  await act(async () => { node(11).click(); });
  await focus(11);
  expect(tip()).toContain("Rank 1/5");
  expect(tip()).toMatch(/Next rank:.*not in the game files we read/);
  for (let i = 0; i < 4; i++) await act(async () => { node(11).click(); });
  await focus(11);
  expect(tip()).toContain("Rank 5/5");
  expect(tip()).not.toContain("Next rank:");

  // A tiered talent: the rank held names its own entry, and Next rank gives the next entry's text from the files.
  await focus(53);
  expect(tip()).toContain("Tier one");
  expect(tip()).not.toContain("Next rank:");
  await act(async () => { node(53).click(); });
  await focus(53);
  expect(tip()).toMatch(/^Tier one/);
  expect(tip()).toContain("Text of Tier one.");
  expect(tip()).toMatch(/Next rank:\s*Text of Tier two\./);
});
