import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { EntityLayout, EntitySidebar } from "./entity";

test("the reserved wide column renders only supplied existing blocks, once", () => {
  const html = renderToStaticMarkup(<EntityLayout><h1>Helm</h1><EntitySidebar><p>Existing sources</p><a href="/map">Existing map</a><a href="/database/items">Related</a></EntitySidebar><p>Existing table</p></EntityLayout>);
  for (const text of ["Existing sources", "Existing map", "Related", "Existing table"]) expect(html.split(text)).toHaveLength(2);
  expect(html).toContain("xl:grid");
  expect(html).toContain("contents xl:block");
  expect(renderToStaticMarkup(<EntitySidebar>{null}</EntitySidebar>)).not.toContain("Sources");
});
