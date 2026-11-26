import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import armory from "@/components/talents/armory-talents.fixture.json";
import { armoryCharacter } from "@/lib/armory.fixture";
import { TalentTrees } from "./profile";

// The Talents tab draws the class's trees read-only, with the armory's ranks filled in, and opens the build in the
// calculator. A name the calculator does not know keeps Blizzard's list and says why.

const kaz = armory.kazSneaks;
const rogue = armoryCharacter({ class: "Rogue", classId: 4 });

test("Kaz Sneaks' talents are drawn as the three rogue trees, 31/20/0, read-only", () => {
  const html = renderToStaticMarkup(<TalentTrees character={rogue} trees={kaz} open />);
  expect(html).toContain('aria-label="Assassination talents, 31 points"');
  expect(html).toContain('aria-label="Combat talents, 20 points"');
  expect(html).toContain('aria-label="Subtlety talents, 0 points"');
  // Malice is full at 5 of 5; a read-only node says its rank and nothing about taking points.
  expect(html).toMatch(/aria-label="Malice, rank 5 of 5, row 1"/);
  expect(html).not.toContain("can take a point");
  expect(html).not.toContain("locked");
  expect(html).not.toContain("Talent details");
});

test("the build opens in the calculator with the calculator's own build link", () => {
  const html = renderToStaticMarkup(<TalentTrees character={rogue} trees={kaz} open />);
  expect(html).toMatch(/<a [^>]*href="\/tools\/talents\/rogue\/b\/EL1-rogue-\d+-[\d.]+-[A-Za-z0-9_-]+"[^>]*>Open this build in the calculator<\/a>/);
});

test("a name the calculator does not know keeps Blizzard's list and says which", () => {
  const trees = [{ name: "Demonology", points: 6, talents: [{ name: "Unholy Power", rank: 5 }, { name: "Made-up Talent", rank: 1 }] }];
  const html = renderToStaticMarkup(<TalentTrees character={armoryCharacter({ class: "Warlock", classId: 9 })} trees={trees} open />);
  expect(html).toContain("Made-up Talent");
  expect(html).toContain("Talent details");
  expect(html).toContain("Shown as a list: Demonology: Made-up Talent is not in the calculator&#x27;s tree.");
  expect(html).not.toContain("role=\"group\"");
  expect(html).toContain('href="/tools/talents/warlock"');
});

test("the fallback list sets only the numbers in mono; 'points' and 'Rank' stay in the text font", () => {
  const trees = [{ name: "Demonology", points: 6, talents: [{ name: "Made-up Talent", rank: 1 }] }];
  const html = renderToStaticMarkup(<TalentTrees character={armoryCharacter({ class: "Warlock", classId: 9 })} trees={trees} open />);
  expect(html).toMatch(/<span class="font-mono tabular-nums">6<\/span> points/);
  expect(html).toMatch(/Rank <span class="font-mono tabular-nums">1<\/span>/);
  expect(html).not.toMatch(/class="[^"]*font-mono[^"]*">(?:\d+ points|Rank \d)/);
});
