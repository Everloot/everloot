import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));

import EntityChanges, { changesFor } from "./entity-changes";

const changes = [
  { id: "wowf-201", build: "1.60.1.201", rows: [{ label: "Talent ranks", before: "1", after: "3" }] },
  { id: "wowf-200", build: "1.60.1.200", rows: [{ label: "Tooltip text changed", before: null, after: null }, { label: "Effect 1 base points", before: "5", after: "8" }] },
];

test("lists each build's changes newest first, linking the build on /changes", () => {
  const html = renderToStaticMarkup(<EntityChanges changes={changes} name="Mutilate" />);
  expect(html).toContain("Changes across builds");
  expect(html).toContain("found in game files, unconfirmed");
  expect(html.indexOf("1.60.1.201")).toBeLessThan(html.indexOf("1.60.1.200"));
  expect(html).toContain('href="/changes?show=builds&amp;q=1.60.1.201"');
  expect(html).toContain("Changed in build");
  expect(html.replace(/<[^>]+>/g, "")).toContain("Effect 1 base points: 5 → 8");
  expect(html).toContain("Tooltip text changed");
});

test("renders nothing for an entity that never changed", () => {
  expect(renderToStaticMarkup(<EntityChanges changes={[]} name="Evasion" />)).toBe("");
});

test("reads the committed build records: Vampiric Embrace changed in 71037, and a pre-launch build stays out", () => {
  const vamp = changesFor({ kind: "spell", id: 15286 });
  expect(vamp.map((b) => b.build)).toContain("1.60.1.71037");
  expect(vamp.find((b) => b.build === "1.60.1.71037")!.rows).toContainEqual({ label: "Effect 1 base points", before: "20", after: "10" });
  // Booming Voice changed only in 70790, before launch, so it is a spoiler and gives nothing.
  expect(changesFor({ kind: "spell", id: 12321 })).toEqual([]);
});
