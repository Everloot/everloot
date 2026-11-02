import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ScoreSection } from "./score";

const visible = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("the score section states the formula and labels its example as made up", () => {
  const html = renderToStaticMarkup(<ScoreSection />);
  expect(html).toContain('id="score"');
  const text = visible(html);
  expect(text).toContain("not shown anywhere yet");
  expect(text).toContain("proposed formula, version 1");
  expect(text).toContain("A raid boss is worth 10 times its raid's tier");
  expect(text).toContain("2 other players' installs, from 2 other addresses, report the same kill within 10 minutes");
  expect(text).toContain("achievement points divided by 10 (rounded down), 10 for each faction at Exalted, 5 for each title and 1 for every 25 completed quests");
  expect(text).toContain("Made-up example. No boss, list or character below is real.");
});

test("the example prints the plan's numbers, from the formula", () => {
  const text = visible(renderToStaticMarkup(<ScoreSection />));
  expect(text).toContain("4 tier-1 raid bosses: 40; 12 dungeon bosses, 3 of them final bosses: 18. Progress is 58 .");
  expect(text).toContain("410 achievement points: 41; 2 Exalted factions: 20; 1 title: 5; 180 quests: 7. Completion is 73 .");
  expect(text).toContain("A's Everloot Score is 58 + 73 = 131 .");
  expect(text).toContain("scored the same way at 34 and 9");
  expect(text).toContain("The account's score is its best character's: 131 .");
  expect(text).toContain("killed 18 different bosses");
});
