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
  expect(html.replace(/<[^>]+>/g, "")).toBe("files read 80001 \u00b7 newest seen 80002");
  expect(html.match(/<a /g)).toHaveLength(2);
  expect(html).toContain('href="/changes?show=builds&amp;q=1.60.1.80001"');
  expect(html).toContain('href="/changes"');
  expect(html).toContain('title="The game files');
  expect(html).toContain('title="The newest WoW: Forever build');
});
