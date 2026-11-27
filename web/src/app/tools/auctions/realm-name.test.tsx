import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { RealmName, realmDisplayName } from "./RealmName";

test("a recorded CAMWOW realm reads as its short name in text and on hover, never the recorded code", () => {
  expect(realmDisplayName("CAMWOW US1 Realm 4 PvP")).toBe("US1 · Realm 4 PvP");
  expect(realmDisplayName("Forever")).toBe("Forever");
  const html = renderToStaticMarkup(<RealmName name="CAMWOW US1 Realm 4 PvP" />);
  expect(html).toContain('title="US1 · Realm 4 PvP"');
  expect(html).not.toContain("CAMWOW");
  expect(html).toMatch(/US1 · Realm 4 (?:<[^>]*>)*PvP/);
});
