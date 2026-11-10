import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import EntityLink from "./EntityLink";

test.each(["spell", "vendor"] as const)("a %s EntityLink targets the page recognized by hover cards", (kind) => {
  const html = renderToStaticMarkup(<EntityLink kind={kind} id={10} name="Shown name" />);
  expect(html).toContain(`href="/database/${kind}s/10"`);
  expect(html).toContain("Shown name");
  expect(html).not.toContain("data-no-hover-card");
});
