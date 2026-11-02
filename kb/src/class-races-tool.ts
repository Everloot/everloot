import { GAME_DATA_CREDIT, TALENT_CLASSES, type McpToolArgs, type TalentClass } from "@everloot/protocol";
import { RACE_FACTIONS, type RaceTable } from "./client-races.js";
import { RACIAL_NOTES, type NotedTrait } from "./racial-notes.js";
import { classUrl, moreLine } from "./page-urls.js";

/**
 * class_races: who can be a class, per faction, with each race's racial traits, from the committed race table
 * (web/src/data/game-data/races.json). Game-file data, found in game files, unconfirmed; the answer carries the
 * build and ends with Blizzard's credit. Trait descriptions are game text and stay on the class page. The server
 * passes the table with Blizzard's later racial pass applied (racial-notes.ts); the answer then names those notes.
 */

type Answer = { text: string; structured: object };

const LABEL = "found in game files, unconfirmed";

export function handleClassRaces(args: McpToolArgs<"class_races">, table: RaceTable): Answer {
  const wanted = args.class.trim().toLowerCase();
  const slug = TALENT_CLASSES.find((c) => c === wanted);
  const stamp = `${LABEL}; build ${table.build.version}`;
  const className = slug && table.races.flatMap((r) => r.classes).find((c) => c.name.toLowerCase() === slug)?.name;
  if (!slug || !className) {
    const names = [...new Set(table.races.flatMap((r) => r.classes.map((c) => c.name)))].sort();
    const error = `No class named ${args.class.trim()} in the game files. Classes: ${names.join(", ")}.`;
    return {
      text: `${error}\n${GAME_DATA_CREDIT}`,
      structured: { label: table.label, build: table.build.version, factions: [], error, credit: GAME_DATA_CREDIT },
    };
  }
  const factions = RACE_FACTIONS
    .filter((f) => !args.faction || f.toLowerCase() === args.faction)
    .map((faction) => ({
      faction,
      races: table.races
        .filter((r) => r.faction === faction && r.classes.some((c) => c.name === className))
        .map((r) => ({ id: r.id, name: r.name, traits: r.traits.map((t) => ({ name: t.name, kind: t.kind, order: t.order })) })),
    }))
    .filter((f) => f.races.length > 0);
  const lines = [`Who can be a ${className}${args.faction ? ` (${factions[0]?.faction ?? args.faction})` : ""}, with racial traits (${stamp}):`];
  if (factions.length === 0) lines.push(`No race can be a ${className} on that faction in this build.`);
  for (const f of factions) {
    lines.push(f.faction);
    for (const r of f.races) lines.push(`  ${r.name}: ${r.traits.map((t) => `${t.name} (${t.kind})`).join(", ") || "no traits listed"}`);
  }
  const noted = table.races.some((r) => r.traits.some((t) => (t as NotedTrait).fromNotes));
  if (noted) lines.push(`Racial changes from ${RACIAL_NOTES.sourceName}, ${RACIAL_NOTES.sourceTitle}: ${RACIAL_NOTES.sourceUrl}`);
  const url = classUrl(slug);
  lines.push(moreLine(url), GAME_DATA_CREDIT);
  return {
    text: lines.join("\n"),
    structured: {
      label: table.label, build: table.build.version, class: slug as TalentClass, className,
      ...(args.faction ? { faction: args.faction } : {}),
      factions, credit: GAME_DATA_CREDIT, url,
    },
  };
}
