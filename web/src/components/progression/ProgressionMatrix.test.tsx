import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { characterProgression, progressionCatalogue } from "@kb/progression";
import ProgressionMatrix from "./ProgressionMatrix";

const catalogue = progressionCatalogue({ entrances: [], encounters: [] });
test("every instance is drawn in three groups with honest availability, no invented links or kills", () => {
  const html = renderToStaticMarkup(<ProgressionMatrix instances={characterProgression(catalogue, null)} links={{ 33: "/database/instances/33-shadowfang-keep" }} />);
  expect([...html.matchAll(/data-progression-instance=/g)]).toHaveLength(catalogue.length);
  for (const group of ["Dungeons", "Raids", "World bosses"]) expect(html).toContain(`>${group}</h`);
  expect(html).toContain('href="/database/instances/33-shadowfang-keep"');
  expect(html).not.toContain('href="/database/instances/3002');
  expect(html).toContain("no data from this character");
  expect(html).toContain("not seen open yet");
  expect(html).not.toContain('role="progressbar"');
  expect(html).toContain("not a Blizzard release announcement");
  expect(html).toContain("Blizzard&#x27;s API gives no encounter data");
  expect(html).toContain("linked and consented");
});

test("states, boss counts, latest UTC day and neutral bars convey actual history", () => {
  const kills = [
    ...catalogue.find((r) => r.id === 249)!.bosses.map((b) => ({ instanceMapId: 249, encounterId: b.id, lastKillAt: "2026-11-18T01:00:00Z" })),
    { instanceMapId: 33, encounterId: 2748, lastKillAt: "2026-11-19T01:00:00Z" },
  ];
  const html = renderToStaticMarkup(<ProgressionMatrix instances={characterProgression(catalogue, kills)} />);
  for (const state of ["cleared", "partial", "none"]) expect(html).toContain(`>${state}</span>`);
  expect(html).toContain('aria-valuenow="1"');
  expect(html).toContain('dateTime="2026-11-19"');
  expect(html).toContain("1 / 8 bosses");
  expect(html).toContain("bg-fg-2");
  expect(html).toContain("border-radius:4px");
});
