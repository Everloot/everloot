# Open data export

The published data as files anyone can download and build on (ROADMAP, "Next"). A maintainer makes one with
`npm run kb -- open-data`, uploads it by hand, and the page at
[`/database/download`](https://everloot.app/database/download) lists it with its date, its counts and its licence.

It is not the [bulk export](RELEASING.md#bulk-export). The bulk export writes what the JSON API serves, including
every anonymous record, one- and two-install records too. This export writes only facts that three installs agree on,
and the game-file layer in its own folder, so its licence can say plainly what is in it.

## What is in a folder

```text
manifest.json     the build, the dates, the method, the licence, and per file: rows, of how many, bytes, SHA-256
README.md         the same in words, with the counts
LICENCE.md        CC BY-SA 4.0 for observed/, Blizzard's terms for game-files/
observed/         NDJSON, one fact per line, only what 3 or more installs agree on
game-files/       NDJSON, what the game's own files say for the build in the manifest (Blizzard's data)
schema/           a JSON Schema for every file
```

Observed files: `npcs`, `quests`, `vendor-offers`, `drop-rates`, `drop-measured-zeros`, `relations`, `entrances`,
`bosses`, `objects`, `object-pins`, `item-names`. Game-file files: `item-categories`, `relations`, `zones`,
`continents`, `entrances`, `flight-masters`, `flight-paths`. The builders and the row schemas are in
[`kb/src/open-data/build.ts`](../kb/src/open-data/build.ts); the words (licence, method, exclusions) are in
[`text.ts`](../kb/src/open-data/text.ts), which the README, the licence text and the page all read.

Every observed row carries how many installs agree (`installs`, at least 3) and no install id, no pseudonym and no
name of a player. A value nobody has three installs on is `null`, on the page `[?]`, never a blank or a zero.
Every count is rows out of how many were reported, with what that counts in words, the date the data was current and
the method, so a number is never bare. The JSON API and the MCP tools call the same count `reporters`: it is the same
number, the installs that agree on the fact, under the name those shapes use.

## Make one

In `kb/`, with `web/node_modules` installed (the kb command reads the committed game data under `web/src/data`):

```text
EVERLOOT_PUBLIC_CORPUS_URL=https://everloot.app/api/corpus/public EVERLOOT_API_KEY=<a free key> \
  npm run kb -- open-data <new folder outside the repository>
```

The records come from the public corpus API (the free key lifts the per-address limit so the whole feed is read), from
`EVERLOOT_UPLOADS` (a local folder of uploads), or from a saved copy of the feed: `--records <file>` takes the API's
answer as JSON, a list, or NDJSON, and refuses the whole file when one record is not a valid public record. With
no source at all the command stops: an export of nothing would say that nothing was confirmed, which is not known.

The folder must be new or empty. Nothing is written when a row is refused.

### What it refuses

- A row whose schema it does not satisfy. Every `installs` field is an integer of at least 3, a fact and its count are
  both set or both `null`, and the row objects are strict, so an extra key (an `installId`, a character name) fails.
- An observed row that holds a string equal to an install id of the input.
- Any file that carries what looks like a local filesystem path.
- Record kinds it does not read. Only `npc_sighting`, `quest`, `vendor`, `loot`, `item_seen`, `instance_entrance`,
  `encounter` and `object_sighting` are read, so named records, census rows and addon lists cannot reach a row.
- The local Classic baseline. The exporter imports nothing from the baseline or coverage report, and a test reads its
  source to keep it that way. A count whose denominator comes from the baseline stays on the coverage page.

`kb/test/open-data.test.ts` runs the exporter over a corpus where every kind of fact is held by one, two and three
installs and shows that only the three-install facts come out.

## Publish one (owner step)

The same public bucket as the bulk export, under its own prefix, so `latest.json` of the bulk export is never touched:

```text
node scripts/upload-open-data.mjs <folder>        (in web/, with the R2 variables and BULK_BUCKET set)
```

It checks every file against the manifest's hashes, refuses a path outside the export or a local path, writes every
object create-only, the manifest last, and then `open-data/latest.json`. The page reads
`NEXT_PUBLIC_BULK_URL/open-data/latest.json`, the variable the bulk download already uses. Until an export is uploaded
the page says there is none and prints no number.

## Adding a dataset

Write its builder in `build.ts` with a strict row schema, set `candidates` and what they count, and extend the
fixture in `kb/test/open-data.test.ts` with a one-, a two- and a three-install version of the fact. A dataset whose rule
is not "three installs agree" does not belong in `observed/`; say so in the pull request and in
[`DATA_POLICY.md`](DATA_POLICY.md) first.
