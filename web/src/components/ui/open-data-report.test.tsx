import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import OpenData from "./OpenData";

test("the open-data row carries a Report wrong data link prefilled for the page, opening GitHub in a new tab", () => {
  const out = renderToStaticMarkup(<OpenData text="Hogger" report={{ type: "NPC", id: 448, path: "/database/npcs/448" }} />);
  const link = /<a [^>]*>Report wrong data<\/a>/.exec(out)?.[0] ?? "";
  expect(link).toContain('href="https://github.com/Everloot/everloot/issues/new?template=wrong-data.yml&amp;title=Wrong+data%3A+NPC+448+%28build+');
  expect(link).toContain("link=https%3A%2F%2Feverloot.app%2Fdatabase%2Fnpcs%2F448");
  expect(link).toContain('target="_blank"');
  expect(link).toContain('rel="noopener noreferrer"');
});

test("a row with no report, as the downloads page has, shows no report link", () => {
  expect(renderToStaticMarkup(<OpenData text="x" jsonHref="/x.json" />)).not.toContain("Report wrong data");
});
