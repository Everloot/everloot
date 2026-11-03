import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import LegacyPerks from "@/components/LegacyPerks";
import { LEGACY_PERKS } from "@/data/game-data/legacy-perks";
import { TOOL_GROUPS } from "@/data/tools";
import { LegacyPerkCatalog } from "../../../../../kb/src/legacy-perks/catalog";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/tools/legacy" }));

const page = async () => {
  const { default: LegacyPerksPage } = await import("./page");
  return renderToStaticMarkup(<LegacyPerksPage />);
};

test("lists every tree and perk in the data file, with node and entry ids and ranks", async () => {
  const html = await page();
  for (const tree of LEGACY_PERKS.trees) {
    expect(html).toContain(`Legacy tree ${tree.id}`);
    for (const node of tree.nodes) {
      expect(html).toContain(`>${node.id}<`);
      for (const e of node.entries) expect(html).toContain(String(e.id));
      if (node.entries[0]?.name) expect(html).toContain(node.entries[0].name);
    }
  }
  expect(html).toContain(">Dedicated Study<");
  expect(html).toContain("(5 tiers)");
});

test("carries the game-files label, the build stamp and Blizzard's credit", async () => {
  const html = await page();
  expect(LEGACY_PERKS.label).toBe("found in game files, unconfirmed");
  expect(html).toContain("Found in game files, unconfirmed.");
  expect(html).toContain(`Build ${LEGACY_PERKS.build.version}`);
  expect(html).toContain("Blizzard Entertainment");
});

test("shows the cost and cap only as unconfirmed readings, and gates as partial", async () => {
  const html = await page();
  expect(html).toContain("Cost per rank: 1, an unconfirmed reading of TraitTreeXTraitCost, TraitCost.Amount.");
  expect(html).toContain("Most points a character holds: 16, an unconfirmed reading of TraitCurrency.SourcedMax.");
  expect(html).toContain("5 points spent (where they count is unconfirmed)");
  expect(html).toContain("Spend gates are partial");
  // Nothing on the page spends points.
  expect(html).not.toMatch(/<button|<input/);
});

test("an unknown cost, cap or gate scope shows no number", () => {
  const tree = LEGACY_PERKS.trees[0]!;
  const catalog = LegacyPerkCatalog.parse({
    ...LEGACY_PERKS,
    currencies: LEGACY_PERKS.currencies.map((c) => ({ ...c, cap: { value: null, confidence: "unknown", from: "TraitCurrency.SourcedMax absent" } })),
    trees: [{
      ...tree,
      cost: { value: null, confidence: "unknown", from: "no TraitTreeXTraitCost row", traitCostId: null, currencyId: null },
      gates: tree.gates.map((g) => ({ ...g, countedGroupId: null, counted: [], confidence: "unknown" })),
    }],
  });
  const html = renderToStaticMarkup(<LegacyPerks catalog={catalog} />);
  expect(html).toContain("Cost per rank: not known.");
  expect(html).toContain("Most points a character holds: not known.");
  expect(html).not.toMatch(/Cost per rank: \d/);
  expect(html).not.toMatch(/holds: \d/);
  expect(html).toContain("(where they count is not known)");
});

test("is in the Tools menu", () => {
  expect(TOOL_GROUPS.flatMap((g) => g.links.map((l) => l.href))).toContain("/tools/legacy");
});
