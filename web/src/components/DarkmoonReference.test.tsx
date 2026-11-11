import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import DarkmoonItemNote from "./DarkmoonItemNote";
import DarkmoonGuide from "@/app/guides/darkmoon-faire/page";

test("a turn-in item explains its use with its source and uncertainty", () => {
  const html = renderToStaticMarkup(<DarkmoonItemNote name="Small Furry Paw" />);
  expect(html).toContain("5 Small Furry Paw → 1 ticket");
  expect(html).toContain("Community-sourced");
  expect(html).toContain("unverified in Forever");
  expect(html).toContain("/guides/darkmoon-faire");
  expect(html).toContain("17RyCVOfrmgrJxbRma-FL4LyGNukmAm08zsVVI5oc8dI");
  expect(html).toContain("level 1");
});

test("unrelated and unknown items receive no Darkmoon claim", () => {
  expect(renderToStaticMarkup(<DarkmoonItemNote name="Linen Cloth" />)).toBe("");
  expect(renderToStaticMarkup(<DarkmoonItemNote />)).toBe("");
});

test("the reference includes all source turn-ins without claiming verified rewards or prices", () => {
  const html = renderToStaticMarkup(<DarkmoonGuide />);
  for (const item of ["Small Furry Paw", "Copper Modulator", "Soft Bushy Tail", "Vibrant Plume", "Thorium Widget", "Rugged Armor Kit"]) expect(html).toContain(item);
  expect((html.match(/data-darkmoon-row=/g) ?? []).length).toBe(20);
  expect(html).toContain("unverified in Forever");
  expect(html).toContain("reputation caps");
  expect(html).toContain("50 tickets");
  expect(html).toContain("Jerome");
  expect(html).toContain("/search?q=Vibrant%20Plume");
  expect(html).not.toContain("0.2799");
  expect(html).not.toContain("16-slot");
});
