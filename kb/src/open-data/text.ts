import { CREDIT_LINE, GAME_DATA_CREDIT, LICENCE, LICENCE_URL, SITE } from "@everloot/protocol";
import { CLIENT_LABEL } from "../edges.js";
import { WORLD_AGREEMENT } from "../fact-states.js";
import type { OpenDataManifest } from "./manifest.js";

/**
 * The words of the open data export, in one place. The README and LICENCE the exporter writes into the folder and
 * the download page (`/database/download`) both read them, so the licence, the credit line, the method and the
 * list of what is left out cannot differ between the files and the page.
 */

export const OPEN_DATA_PAGE = `${SITE}/database/download`;

export const OPEN_DATA_METHOD =
  `A fact is a row in the observed files only when ${WORLD_AGREEMENT} or more installs agree on it: the same value for the same thing, `
  + "from installs that are not the same player (Polestar Recorder installs that share a character or an address count once). "
  + "Where installs disagree and no value has three, the fact is left out. The game-files folder holds what the game's own files say, "
  + "read from the build named in the manifest, and are kept apart because they are Blizzard's.";

/** What the files never hold, by rule (docs/DATA_POLICY.md). */
export const OPEN_DATA_EXCLUDED: readonly string[] = [
  `Facts that fewer than ${WORLD_AGREEMENT} installs report, and facts the installs disagree on. Each file counts them (its "of how many" number) and never lists them.`,
  "The local Classic baseline: pfQuest's database and the emulator databases it is built from, which are GPL. It stays on a maintainer's machine. No row, name or id from it is in these files. A count whose denominator comes from it appears only on the site's coverage page.",
  "Anything a player's name is attached to: character names, guild data, player pages, census rows and addon lists. Rows carry no install id and no pseudonym either, only how many installs agree.",
  "The individual upload records. They are public as anonymous records, with one pseudonym per install, through the corpus API (/docs/api/corpus-public), not in this export.",
  "Item names, quest titles, spell and item set names, descriptions and tooltip text read from the game files or the Warcraft Wiki, and icons and art. They are on the site's pages only. An item, NPC or object name is in the observed files only when three installs reported the same one; the game-files folder names only what its catalogs name (achievements, factions, titles, quest lines, mounts, encounters, races, perks, talents, raid buffs).",
  "Zones, flight masters and flight lines the game files hold that may not be released yet.",
];

/** What a reader might expect and this version does not carry. */
export const OPEN_DATA_NOT_YET: readonly string[] = [
  "Market prices, census counts, trainer facts, and the zone bounds players measured. Some are on the site or in its API; none are in these files yet.",
  "The loot windows behind each drop rate, source by source.",
];

/** How to read a number in a row. */
export const OPEN_DATA_READING: readonly string[] = [
  "A drop rate is the share of a source's loot windows that held the item: the windows the game's loot API attributed to it, and the empty ones the addon tied to their corpse. It is not a kill-based drop chance, and a window is a loot, not a kill. Windows from addons older than the empty-window release leave out the corpses that held nothing, so their rates read high.",
  "A position on a map is on the 0 to 100 map scale and is the median of the installs' positions. Positions in the game-files folder are in world yards.",
  "The installs count is how many installs agree, not how many people: three installs are not proof of three players.",
];

/** How to check a count, in the order a person would. */
export const OPEN_DATA_VERIFY: readonly string[] = [
  "Check the files: the SHA-256 and the byte count of each file are in manifest.json, and the number of lines in a file is its row count.",
  `Check a fact: every observed row says how many installs agree. The records behind it are public, one pseudonym per install, at ${SITE}/api/corpus/public (add ?kinds=npc_sighting for NPCs, quest, vendor, loot, item_seen, instance_entrance, encounter or object_sighting for the others). Count the distinct pseudonyms that report the same value: it must be at least ${WORLD_AGREEMENT}, and it matches the row up to the records uploaded after dataAsOf.`,
  "Check the denominator: each file's \"of how many\" is the count of that kind of thing that anyone reported at least once. Count the same thing in the records.",
  "Rebuild it: the exporter is in the repository (npm run kb -- open-data <folder> in kb/). With the same records and the same build it writes the same rows.",
];

export const GAME_FILES_LABEL = CLIENT_LABEL;

const at = (iso: string | null) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : "[?]");
const n = (x: number) => x.toLocaleString("en-US");

/** The licence text of the folder, in plain words. Not legal advice. */
export function renderLicence(m: OpenDataManifest): string {
  return [
    "# Licence",
    "",
    "This folder has two parts, and they are not under the same terms.",
    "",
    "## `observed/`: Everloot's data, CC BY-SA 4.0",
    "",
    "What players saw in the game and three installs agree on. Everloot's contributors made it, and it is released under",
    `${LICENCE} (${LICENCE_URL}). In short: you may copy it, change it and build on it, including commercially, if you`,
    "",
    `- credit it, with this line and a link: "${CREDIT_LINE}", and`,
    `- release what you build from it under the same licence (${LICENCE}).`,
    "",
    "Republishing it without the credit breaks the licence.",
    "",
    "## `game-files/`: Blizzard's data, not under our licence",
    "",
    `${GAME_DATA_CREDIT}`,
    "",
    `Every row there is labelled "${GAME_FILES_LABEL}": it is in the game's files for build ${m.gameFiles.version}, which does not`,
    "mean it is, or will be, in the game. The files hold ids, numbers, relations between ids, place names and rectangles. They hold no icons,",
    "tooltip text or art, and Everloot does not relicense any of it. If Blizzard asks us to remove something, we remove it.",
    "Check Blizzard's terms yourself before you reuse it.",
    "",
    "Everloot is a fan project and is not affiliated with or endorsed by Blizzard Entertainment.",
    "",
    "This is our reading of the rules, not legal advice. The data policy is docs/DATA_POLICY.md in the repository.",
    "",
  ].join("\n");
}

/** The README of the folder: what it is, when, how many, under what licence, by what method and what is not in it. */
export function renderReadme(m: OpenDataManifest): string {
  const table = m.files.map((f) =>
    `| \`${f.path}\` | ${n(f.rows)} | ${f.candidates === null ? "[?]" : n(f.candidates)} | ${f.candidatesAre} |`);
  const list = (items: readonly string[]) => items.map((i) => `- ${i}`);
  return [
    "# Everloot open data",
    "",
    `The published data of ${SITE} as files, so you can build on it. One JSON object per line (NDJSON), one folder for what players`,
    "confirmed and one for what the game files say.",
    "",
    `- Made: ${at(m.generatedAt)}`,
    `- Data current as of: ${at(m.dataAsOf)} (the uploads behind the observed files)`,
    `- Game build of the game-files folder: ${m.gameFiles.version}`,
    `- Read: ${n(m.source.records)} public records from ${n(m.source.installs)} ${m.source.installs === 1 ? "install" : "installs"}`,
    `- Page: ${OPEN_DATA_PAGE}`,
    "",
    "## Licence and credit",
    "",
    `\`observed/\` is ${m.licence.observed.name} (${m.licence.observed.url}). Credit it with: "${m.licence.observed.credit}"`,
    "What you build from it stays under the same licence.",
    "",
    `\`game-files/\` is Blizzard's data and is not under that licence. ${m.licence.gameFiles.credit} See LICENCE.md.`,
    "",
    "## Method",
    "",
    m.method.text,
    "",
    "A `null` in a row means unknown: fewer than three installs agree on it yet (the site prints it as `[?]`). It is never a blank or a zero.",
    "",
    "## Reading the numbers",
    "",
    ...list(OPEN_DATA_READING),
    "",
    "## What is in it",
    "",
    "| File | Rows | Of how many | What the second number counts |",
    "|---|---:|---:|---|",
    ...table,
    "",
    "Every file has its row schema in `schema/` (JSON Schema). Each file's rows, bytes and SHA-256 are in `manifest.json`.",
    "",
    "## What is not in it",
    "",
    ...list(m.excluded),
    "",
    "Not in this version yet:",
    "",
    ...list(m.notYet),
    "",
    "## How to verify a count",
    "",
    ...m.verify.map((v, i) => `${i + 1}. ${v}`),
    "",
  ].join("\n");
}
