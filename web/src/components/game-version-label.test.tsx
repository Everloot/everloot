import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("@/data/game-data/client-layer.json", () => ({ default: { build: { product: "wowf", version: "1.60.1.80001" } } }));
vi.mock("../../../kb/changes/builds.json", () => ({ default: { builds: [
  { product: "wowf", version: "1.60.1.80002", buildId: 80002, firstSeen: "2026-11-09" },
  { product: "wowf", version: "1.60.1.80001", buildId: 80001, firstSeen: "2026-11-08" },
  { product: "wow_classic_era", version: "1.15.9.90000", buildId: 90000, firstSeen: "2026-11-10" },
] } }));

import GameVersionLabel from "./GameVersionLabel";

test("the header labels both sources and links to their explanations", () => {
  const html = renderToStaticMarkup(<GameVersionLabel />);
  expect(html).toMatch(/>files read 80001<\/a>/);
  expect(html).toMatch(/>newest seen 80002<\/a>/);
  expect(html.match(/<a /g)).toHaveLength(2);
  expect(html).toContain('href="/changes?show=builds&amp;q=1.60.1.80001"');
  expect(html).toContain('href="/changes"');
  expect(html).toContain('title="The game files');
  expect(html).toContain('title="The newest WoW: Forever build');
});

test("with no build read, the label says unknown and links to how the files are read", async () => {
  vi.resetModules();
  vi.doMock("@/data/game-data/client-layer.json", () => ({ default: { build: { product: "wowf", version: null } } }));
  const { default: Label } = await import("./GameVersionLabel");
  const html = renderToStaticMarkup(<Label />);
  expect(html).toMatch(/href="\/methodology#files"[^>]*>files read unknown<\/a>/);
  expect(html).not.toContain("undefined");
});
