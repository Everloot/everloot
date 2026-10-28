import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { openDb } from "../src/db.js";
import { importWikiDump, wikiUrl, wikitextToText } from "../src/importers/wiki-dump.js";
import { search } from "../src/search.js";

const fixture = fileURLToPath(new URL("./fixtures/wiki-sample.xml", import.meta.url));
const zstFixture = fileURLToPath(new URL("./fixtures/wiki-sample.xml.zst", import.meta.url));
const w31Fixture = fileURLToPath(new URL("./fixtures/wiki-sample.w31.xml.zst", import.meta.url));

test("imports only main-namespace, non-redirect pages as lore_page rows", async () => {
  const db = openDb(":memory:");
  const n = await importWikiDump(db, fixture);
  expect(n).toMatchObject({ stored: 1, skipped: 0 });
  const r = db.prepare("SELECT kind, name, game_version, source_url, retrieved_at, licence, data FROM entities").get() as Record<string, string>;
  expect(r).toMatchObject({
    kind: "lore_page",
    name: "Thunderfury",
    game_version: "lore",
    source_url: "https://warcraft.wiki.gg/wiki/Thunderfury",
    retrieved_at: "2023-11-13",
    licence: "CC-BY-SA-4.0",
  });
  expect(JSON.parse(r.data).categories).toContain("Legendary items");
  expect(await search(db, "legendary sword")).toHaveLength(1);
});

test("reads a zstd-compressed dump the same way", async () => {
  const db = openDb(":memory:");
  expect(await importWikiDump(db, zstFixture)).toMatchObject({ stored: 1, skipped: 0 });
  expect(await search(db, "blessed blade")).toHaveLength(1);
});

test("re-import does not duplicate", async () => {
  const db = openDb(":memory:");
  await importWikiDump(db, fixture);
  await importWikiDump(db, fixture);
  const { n } = db.prepare("SELECT count(*) AS n FROM entities").get() as { n: number };
  expect(n).toBe(1);
});

test("limit stops early", async () => {
  const db = openDb(":memory:");
  expect((await importWikiDump(db, fixture, { limit: 1 })).stored).toBe(1);
});

test("reads a dump whose zstd frame declares a 2 GB window (like the real Warcraft Wiki dump)", async () => {
  const db = openDb(":memory:");
  expect(await importWikiDump(db, w31Fixture)).toMatchObject({ stored: 1, skipped: 0 });
});

test("a truncated .zst dump is rejected and keeps the previous rows", async () => {
  const db = openDb(":memory:");
  await importWikiDump(db, fixture);
  const bytes = readFileSync(zstFixture);
  const cut = join(mkdtempSync(join(tmpdir(), "kb-zst-")), "cut.xml.zst");
  writeFileSync(cut, bytes.subarray(0, bytes.length - 20));
  await expect(importWikiDump(db, cut)).rejects.toThrow();
  const { n } = db.prepare("SELECT count(*) AS n FROM entities").get() as { n: number };
  expect(n).toBe(1);
});

test("counts main-namespace pages whose text converts to nothing as skipped", async () => {
  const db = openDb(":memory:");
  const xml =
    '<mediawiki><page><title>Only categories</title><ns>0</ns><id>7</id><revision>' +
    "<timestamp>2023-01-01T00:00:00Z</timestamp><text>[[Category:Stubs]]</text></revision></page></mediawiki>";
  const file = join(mkdtempSync(join(tmpdir(), "kb-xml-")), "skip.xml");
  writeFileSync(file, xml);
  expect(await importWikiDump(db, file)).toMatchObject({ stored: 0, skipped: 1 });
});

test("counts a near-empty template stub (fewer than 20 letters) as skipped, not stored", async () => {
  const db = openDb(":memory:");
  const xml =
    '<mediawiki><page><title>SS TCG Stub</title><ns>0</ns><id>8</id><revision>' +
    "<timestamp>2023-01-01T00:00:00Z</timestamp><text>{{Tcgcard|name=X}}SS TCG</text></revision></page></mediawiki>";
  const file = join(mkdtempSync(join(tmpdir(), "kb-xml-stub-")), "stub.xml");
  writeFileSync(file, xml);
  expect(await importWikiDump(db, file)).toMatchObject({ stored: 0, skipped: 1 });
});

const wikiteam = fileURLToPath(new URL("./fixtures/wiki-wikiteam.xml", import.meta.url));
const wikiteamZst = fileURLToPath(new URL("./fixtures/wiki-wikiteam.xml.zst", import.meta.url));

for (const [label, file] of [["xml", wikiteam], ["xml.zst", wikiteamZst]] as const) {
  test(`WikiTeam-style dump (${label}): one row per page, newest revision across blocks, text redirects dropped`, async () => {
    const db = openDb(":memory:");
    expect(await importWikiDump(db, file)).toEqual({
      stored: 3,
      skipped: 0,
      damaged: 0,
      dropped: { redirect: 1, namespace: 1, empty: 0 },
    });
    const rows = db.prepare("SELECT ext_id, name, body FROM entities ORDER BY CAST(ext_id AS INTEGER)").all() as {
      ext_id: string;
      name: string;
      body: string;
    }[];
    expect(rows.map((r) => r.ext_id)).toEqual(["101", "200", "400"]);
    const [thunderfury, , onyxia] = rows;
    expect(thunderfury.name).toBe("Thunderfury");
    expect(thunderfury.body).toContain("Thunderfury is a legendary sword.");
    expect(onyxia.body).toContain("brood mother");
    expect(onyxia.body).not.toContain("Dustwallow");
  });
}

test("a page split across two blocks with the same newest timestamp keeps the later block's text", async () => {
  const db = openDb(":memory:");
  const xml =
    "<mediawiki>" +
    "<page><title>Tied Page</title><ns>0</ns><id>9</id><revision>" +
    "<timestamp>2023-06-01T00:00:00Z</timestamp><text>Earlier block text, with enough words to pass the stub filter.</text></revision></page>" +
    "<page><title>Tied Page</title><ns>0</ns><id>9</id><revision>" +
    "<timestamp>2023-06-01T00:00:00Z</timestamp><text>Later block text, with enough words to pass the stub filter.</text></revision></page>" +
    "</mediawiki>";
  const file = join(mkdtempSync(join(tmpdir(), "kb-xml-tie-")), "tie.xml");
  writeFileSync(file, xml);
  expect(await importWikiDump(db, file)).toMatchObject({ stored: 1, skipped: 0 });
  const row = db.prepare("SELECT body FROM entities").get() as { body: string };
  expect(row.body).toContain("Later block text,");
});

test("WikiTeam-style dump: limit applies to stored rows", async () => {
  const db = openDb(":memory:");
  expect((await importWikiDump(db, wikiteam, { limit: 1 })).stored).toBe(1);
});

test("WikiTeam-style dump: reports progress for both passes", async () => {
  const db = openDb(":memory:");
  const seen: { pass: 1 | 2; blocks: number }[] = [];
  await importWikiDump(db, wikiteam, { progressEvery: 1, onProgress: (p) => seen.push(p) });
  expect(seen.filter((p) => p.pass === 1).map((p) => p.blocks)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(seen.some((p) => p.pass === 2)).toBe(true);
});

test("wikitextToText strips markup and collects categories", () => {
  const { text, categories } = wikitextToText("'''Thrall''' leads the [[Horde]].\n[[Category:Orcs]]");
  expect(text).toContain("Thrall leads the Horde.");
  expect(categories).toEqual(["Orcs"]);
});

test("wikiUrl builds a readable wiki URL", () => {
  expect(wikiUrl("Thrall (lore)")).toBe("https://warcraft.wiki.gg/wiki/Thrall_(lore)");
  expect(wikiUrl("Ahn'Qiraj: The Fallen Kingdom")).toBe("https://warcraft.wiki.gg/wiki/Ahn'Qiraj:_The_Fallen_Kingdom");
});

const templatesFixture = fileURLToPath(new URL("./fixtures/wiki-templates.xml", import.meta.url));

test("stores type, facets, infobox fields and repaired sentences; reports damage", async () => {
  const db = openDb(":memory:");
  const result = await importWikiDump(db, templatesFixture);
  expect(result).toMatchObject({ stored: 2, skipped: 0, damaged: 0 });
  const rows = db.prepare("SELECT name, body, data FROM entities ORDER BY name").all() as { name: string; body: string; data: string }[];
  const cinch = rows.find((r) => r.name === "Cinch of the Vigil")!;
  expect(cinch.body).toContain("300g");
  expect(cinch.body).toContain("Honored standing");
  expect(cinch.body).toContain("Hiren Loresong");
  expect(cinch.body).toContain("Patch 5.2.0: Added.");
  expect(cinch.body).not.toContain("for at");
  const cinchData = JSON.parse(cinch.data);
  expect(cinchData).toMatchObject({ type: "item", damaged: false, infobox: { template: "#data:itemtip", fields: { ilvl: "476", slot: "Waist" } } });
  expect(cinchData.facets.expansion).toEqual(["Legion"]);
  const saurid = rows.find((r) => r.name === "Nazmir Saurid")!;
  const sauridData = JSON.parse(saurid.data);
  expect(sauridData).toMatchObject({ type: "npc", infobox: { template: "npcbox", fields: { race: "Saurid", location: "Nazmir" } } });
  expect(sauridData.facets.zone).toEqual(["Nazmir"]);
  expect(sauridData.categories).toEqual(["Saurid", "Nazmir mobs"]);
});

test("the original sample is typed as an item from its category and carries no infobox", async () => {
  const db = openDb(":memory:");
  const result = await importWikiDump(db, fixture);
  expect(result.damaged).toBe(0);
  const data = JSON.parse((db.prepare("SELECT data FROM entities").get() as { data: string }).data);
  expect(data.type).toBe("item");
  expect(data).not.toHaveProperty("infobox");
  expect(data.damaged).toBe(false);
});
