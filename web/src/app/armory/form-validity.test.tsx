// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test } from "vitest";
import { CharacterFields } from "./parts";

// The browser's own check on the hide and add forms: the pattern attributes as rendered, run by the DOM's constraint
// validation, the way a form without JavaScript is checked before it is sent.

beforeEach(() => {
  document.body.innerHTML = `<form>${renderToStaticMarkup(<CharacterFields />)}</form>`;
});

const field = (id: "armory-name" | "armory-surname") => document.getElementById(id) as HTMLInputElement;
const valid = (id: "armory-name" | "armory-surname", value: string) => {
  const input = field(id);
  input.value = value;
  return input.checkValidity();
};

test("a decomposed accent (a letter and a combining mark) passes, as a composed one does", () => {
  expect(valid("armory-name", "E\u0301lodie")).toBe(true);
  expect(valid("armory-name", "Élodie")).toBe(true);
  expect(valid("armory-surname", "Bru\u0301n")).toBe(true);
  expect(valid("armory-surname", "Stål")).toBe(true);
  expect(valid("armory-name", "Ольга")).toBe(true);
});

test("a 12-letter name with five decomposed accents (17 code points) fits the browser's limits", () => {
  const name = "A\u0301e\u0301i\u0301o\u0301u\u0301bcdefgh";
  expect([...name].length).toBe(17);
  expect(field("armory-name").maxLength).toBe(24);
  expect(valid("armory-name", name)).toBe(true);
  expect(field("armory-name").validity.tooLong).toBe(false);
});

test("digits, spaces, hyphens and one letter are refused before the form is sent", () => {
  for (const bad of ["Vel1", "Vel kara", "Vel-kara", "V", ""]) expect(valid("armory-name", bad)).toBe(false);
  expect(valid("armory-surname", "Dusk'mantle")).toBe(false);
  expect(field("armory-name").validity.patternMismatch || field("armory-name").validity.valueMissing).toBe(true);
});
