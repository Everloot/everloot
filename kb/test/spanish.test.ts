import { expect, test } from "vitest";
import { openDb } from "../src/db.js";
import { replaceSourceRows, type EntityInput } from "../src/entities.js";
import { search, searchSomeWords } from "../src/search.js";
import { fromSpanish, readsAsSpanish } from "../src/spanish.js";

test("readsAsSpanish: a Spanish question word or an inverted mark, with or without accents; English is not", () => {
  expect(readsAsSpanish("dónde queda Deadmines")).toBe(true);
  expect(readsAsSpanish("donde queda Deadmines")).toBe(true);
  expect(readsAsSpanish("¿Thrall?")).toBe(true);
  expect(readsAsSpanish("where is Deadmines")).toBe(false);
  expect(readsAsSpanish("how much does a mount cost")).toBe(false);
});

test("fromSpanish: filler dropped, asking words glossed, names kept; English unchanged", () => {
  expect(fromSpanish("cuánto cuesta un mount")).toBe("cost mount");
  expect(fromSpanish("dónde aprendo riding")).toBe("learn riding");
  expect(fromSpanish("Cómo llego a Stranglethorn Vale")).toBe("Stranglethorn Vale");
  expect(fromSpanish("cómo llego a stranglethorn vale")).toBe("stranglethorn vale");
  expect(fromSpanish("qué bosses hay en Deadmines")).toBe("bosses Deadmines");
  // A capitalized word after the first is part of a name, Spanish-looking or not.
  expect(fromSpanish("dónde queda El Pollo Grande")).toBe("El Pollo Grande");
  expect(fromSpanish("how much does a mount cost")).toBe("how much does a mount cost");
  // Nothing left: the question as asked.
  expect(fromSpanish("qué es")).toBe("qué es");
});

const page = (extId: string, name: string, body: string): EntityInput => ({
  kind: "lore_page", extId, name, body, gameVersion: "lore", sourceUrl: `https://example.test/${extId}`, retrievedAt: "2023-11-13", data: {},
});

test("search: a Spanish question meets the English page an English one does", async () => {
  const db = openDb(":memory:");
  await replaceSourceRows(db, "warcraft-wiki-2023", ["lore_page"], [
    page("riding", "Riding", "Players learn riding from a trainer; the cost of a mount drops with reputation."),
    page("lizard", "Ash Lizard", "Ash lizards are found on Mount Hyjal."),
  ]);
  expect((await search(db, "cuánto cuesta un mount", 3)).map((h) => h.name)).toEqual(["Riding"]);
  expect((await search(db, "dónde aprendo riding", 3)).map((h) => h.name)).toEqual(["Riding"]);
  expect((await searchSomeWords(db, "cuánto cuesta un mount en Hyjal", 3)).map((h) => h.name)).toContain("Riding");
});
