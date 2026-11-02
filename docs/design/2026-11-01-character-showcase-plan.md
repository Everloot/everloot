# Character showcase and share card: plan

Date: 2026-11-01. Status: plan, no code. Base: `main` at `fc1078a3`. Launch is 2026-11-04 15:00 PT; the first raids
open 2026-12-09.

Goal: an armory-style public page for one character, published by the player who linked it, and a share card
image for it, both from Everloot's own data. Neither waits for a Blizzard profile API. The brief says WoW: Forever
has no profile namespace or date yet and that Classic profile APIs usually lack raid progress, reputations,
professions and collections. Those claims are the brief's and are not checked here.

Rules this plan keeps: only the player's own linked characters, from their own uploads; nothing from `/who`,
inspect or other players' sightings; public only after the owner turns it on, and off again at once; no Blizzard
marketing art; game client art only as [ASSETS](../ASSETS.md) allows; nothing copied from other sites.

Parents: [character profile and showcase design](specs/2026-10-24-character-profile-and-showcase-design.md) (its
sample `/showcase` pages are reused in S0), [owned-character identity ADR](specs/2026-10-28-owned-character-identity.md)
(HUB-P01), [unified player platform](specs/2026-10-28-unified-player-platform.md),
[gap register](../2026-10-28-platform-gap-register.md), [DATA_POLICY](../DATA_POLICY.md).

## 1. What exists today

Flags are read from `web/wrangler.jsonc` vars. Applied database migrations were not read back for this plan.

| Surface | Flag (production) | What it shows | Source |
| --- | --- | --- | --- |
| `/players/<ruleset>/<realm>/<name>` | `EVERLOOT_PLAYER_PAGES=1`; `EVERLOOT_PLAYER_PAGES_INDEX` unset, so noindex | Name, class, race, level, guild, realm, last-seen day; "Hide this character" | `player_seen` sightings, including other players the addon saw (`addon/modules/players.lua`, `web/src/lib/player-pages.ts`) |
| `/players/opt-out` | same | Hides and deletes a character, no account | `character_suppressions` |
| `/u/<handle>` | `EVERLOOT_PROFILES=1` | Ticked character labels (name, class, realm), shared builds, status | Typed labels, not game data (`web/src/app/u/[handle]/page.tsx`) |
| `/me/characters/<id>` | `EVERLOOT_SAVED_BUILDS=1` | One typed label's saved builds; owner only | `build_characters` |
| `POST /api/me/characters/link-codes`, `POST .../links` | `EVERLOOT_CHARACTER_LINKS` unset (404) | Code, then link rows | `web/src/lib/character-links.ts`; no account UI renders it |
| `character_links`, `character_visibility`, `set_visibility`, `public_character()` | none; unwired | `page_public`, `show_gear/collections/gold/guild`, `ranked_*`, `indexable` default false | `supabase/migrations/20261021190000_character_links.sql` |
| `/guilds/...` | `EVERLOOT_GUILDS=1` | Guild kills agreed by 2 installs, roster | `guild_kill` rows; no gear (`kb/src/guilds.ts`) |
| Desktop "Characters" | local only | Gold, gear and item level per named character; keyed progress counts; talent points by class | `desktop/src/main/characters.ts` reads the save file; nothing uploaded |
| Social cards | n/a | Text-and-shapes cards (`renderCard`, `renderBuildCard`); no game art | `web/src/lib/og-card.tsx`, six `opengraph-image.tsx` routes; none per player |

What the addon records about the player's own character, and whether it can be tied to a named, linked character:

| Data | Row kind, module | Character identity in the row | Leaves the machine |
| --- | --- | --- | --- |
| Identity | `character_link` (schema only; no `/everloot link` command yet), `census_self`, `player_seen` | GUID in transit; name and realm | Link: link endpoint only. Census: hashed. Player: when the owner allows it |
| Equipped gear | `gear_snapshot`, `gear.lua` (16 slots, item id, item level, hourly) | `character`, `realm` | Held by Desktop/CLI; web upload only with an operator-issued grant (`kb/src/publication.ts`) |
| Talents | `talent_snapshot`, `talents.lua` (nodes, Blizzard loadout string) | None: class and level only | Anonymous intake; not shown per character anywhere |
| Professions | None. The addon window reads `GetProfessions` locally (`window.lua`); `recipe_observed` is anonymous | None | n/a |
| Reputations, achievements, titles, quests | `*_owned`, `completion.lua` (off until `/everloot completion on`) | Opaque 8-hex `characterKey`; the link row carries `completionKey` to join it | `collection` grant only |
| Collections (mounts, pets) | `collection_owned` is in the schema and allowlist; no addon module writes it | n/a | n/a |
| Raid lockouts | `raid_lockout`, `guild.lua` (`GetSavedInstanceInfo`) | Guild name only, not the character | `guild` grant only |
| Boss kills | `encounter` (anonymous), `guild_kill` (guild's) | None | Anonymous; guild rollup |
| Guild | `player_seen.guild`, `guild_snapshot` | Name on `player_seen` | As above |
| Gold | `gold_snapshot`, `money_event` | `character`, `realm` | `gold` grant only |

Shown nowhere today: a linked character's own page, its gear, talents, professions, reputations or lockouts.

## 2. The showcase

Address: `/characters/<ruleset>/<realm>/<name>`, using the same slug rules as `playerPath`. A separate page, because
the ADR says a link never adds data to a sighting page. It renders only from `public_character()` and the linked
account's own synced rows. Nothing comes from `players`, the census or other installs. No row, a frozen link or a
hidden character returns 404 with noindex.

Sections, in order. Each section has a state (`shown`, `empty`, `private`, `unsupported`), and each shown section
has its own "as of" date:

1. **Identity.** Name in class colour, level, race, class, faction (Skyborne shows no side), realm, from the link
   row. Guild only with `show_guild`, linking to the guild page when that page is public.
2. **Gear.** The latest synced `gear_snapshot`: slot, item linked to `/database/items/<id>`, item level, average.
   Name and icon follow the item rules in ASSETS (3 installs); otherwise "Item <id>". Shown with `show_gear`.
3. **Talents.** (a) In game: the synced `talent_snapshot` for the active spec, linking to
   `/tools/talents/<class>#plan=<code>`, converted to the calculator's own share code. (b) Planned: saved builds the
   owner attaches to the link (`/b/<slug>`), labelled "Planned build".
4. **Professions.** Name, rank / max rank. Learned recipes later (COL-C04).
5. **Reputations.** Faction, standing name, progress bar; only factions the catalog agrees on (3 installs).
   Renown factions show "not supported yet" (they use ranks, not standings).
6. **Raids.** This character's lockout this week (instance, difficulty, bosses killed, reset), plus the guild's
   agreed kills, labelled as the guild's, not this character's attendance. No performance score.
7. **Collections.** Achievements earned, achievement points, titles, from the completion rows. Mounts and pets
   stay `unsupported` until a collector exists.

Gold, PvP, bags, bank and history are not on the page.

**Freshness label.** The brief asks for "verified by addon upload". The ADR's binding wording forbids "verified",
"owner", "proven" and check marks, and these rows can be written by hand. Proposed text: "From the player's own
addon upload, <date> (<n> days ago)" under the header, and "as of <date>" on each section. A section older than 14
days says "May be out of date". A footer line: "Self-reported by this character's linked player through the Everloot
addon. Not checked against Blizzard."

**Empty states.** `empty`: "Nothing synced for this yet" on the owner's preview only; the public page leaves the
section out. `private`: left out publicly. `unsupported`: one line ("The game does not report this to addons yet"),
never a zero. Nothing is estimated.

**Owner controls.** These live on the account's link list (HUB-P03). For each linked character: "Public page"
(`page_public`); a switch per section; "Let search engines index it" (`indexable`, off by default); "Preview as
public"; copy link; download card. Turning a switch off revalidates the page and the card at once. Unlink or hide
deletes the page. No handle and no account is shown publicly unless D6 is accepted (section 4).

## 3. Share card

Rendered with `next/og` from the same view model as the page. No screenshot, no game art, no Blizzard marks:
text, class colour, Geist and the Everloot mark, as `renderBuildCard` already does.

- **1200x630** (`/characters/.../opengraph-image.tsx`, the page's `og:image`). Left: name (class colour, 72px),
  "Level 60 Orc Shaman · <realm>", guild if shown. Right, up to three stat blocks, only from shown sections:
  average item level; this week's raid progress (`6/10 Molten Core`); top two professions with rank. Bottom:
  freshness date and `everloot.app/characters/...`. No blocks shown: name, line and freshness only.
- **Square 1080x1080** (`/characters/.../card-square.png/route.ts`, for Discord and social posts). The same blocks
  stacked; the download button on the owner controls serves this one.
- Both are cached with the page, revalidated on any owner switch, and 404 when the page is.
- New code: `renderCharacterCard(view, size)` in `web/src/lib/og-card.tsx`; snapshot tests per state.

## 4. Slices

Each slice ships on its own and is covered by `EVERLOOT_SHOWCASE` (new, off) unless noted. "Pure code" can merge
on review. "Carlos" means it waits on a flag flip, an applied migration or a policy decision.

| # | Slice | Size | Needs | Before 11/04 |
| --- | --- | --- | --- | --- |
| S0 | Showcase view model, section components, sample page | M | Pure code; Carlos only to turn the sample page on | Yes |
| S1 | Character card renderer, both sizes, on the sample | S | Pure code | Yes |
| S2 | Link Step 1 (HUB-P02/P03): `/everloot link`, Desktop sender, owner list and unlink | M | Code can merge; turning it on needs D0 wording, D8 dispute contact, migration readback, `EVERLOOT_CHARACTER_LINKS=1` | Code only |
| S3 | Identity-only public page and real card | M | Carlos: public-character contract, a DATA_POLICY section, `EVERLOOT_SHOWCASE=1` | No (launch week at best) |
| S4 | Planned builds on the page | S | Carlos: apply the `build_characters.link_id` migration | No |
| S5 | Private own-character sync: gear, talents, reputations, professions, lockouts | L | Carlos: D1 and D9, sources/consent migration, `sync:own` scope | No |
| S6 | Public sections and per-section switches | M | Carlos: publication rule for linked characters; migration for new `show_*` columns | No |
| S7 | Raid section | M | After S5 and S6; target before 12/09 | No |

**S0.** `web/src/lib/character-showcase.ts` builds a typed `Showcase` (sections, states, dates) from plain inputs.
Components in `web/src/components/showcase/`. Fixtures in `web/src/data/showcase.ts` (Examplechar of Sampleguild
on Showcase, as the 10-24 design names them). `/showcase/character` behind the flag, with the sample-data banner
and noindex. Tests: flag off gives 404; each section renders in each of its four states; `unsupported` never prints
0; the banner and noindex are present; item names follow the 3-install rule through the existing item-facts reader.

**S1.** `renderCharacterCard` and both routes for the sample. Tests: PNG size 1200x630 and 1080x1080; a card with
no shown sections still renders; long names and realms truncate (reuse the guide-title fitting); no image URL from
the game-assets bucket appears in the markup.

**S2.** Exactly the ADR's "First implementation task (Step 1)", file list and acceptance tests included. Listed
here because S3 cannot ship without it.

**S3.** `/characters/...` from `public_character()`: identity section, freshness from `last_upload_at`, card. A
narrow `POST /api/me/characters/links/<id>/visibility` that calls `set_visibility` with `page_public` and
`indexable` only (session, Origin checked). Robots follow `indexable`; the switch is hidden, and every page
noindex, until Carlos accepts indexing for owner pages. Tests: not public, frozen, suppressed or unlinked gives 404 and the card
404s; turning it off clears the cached page and card (revalidatePath now, CF-09 tag purge later); another account
cannot change it; no handle, account id or key appears in the HTML.

**S4.** Owner attaches a label to a link (ADR compatibility step 1). The page lists that label's shared builds.
Tests: no automatic match by name; unshared builds never appear; unlink keeps the builds.

**S5.** The ADR's Step 2, widened from completion to these categories. Protocol changes: add the completion
`characterKey` to `talent_snapshot`; new `profession_owned` (characterKey, profession, rank, maxRank) from
`GetProfessions`; new `lockout_owned` (characterKey, instance, difficulty, bosses killed, reset) next to the
guild-scoped `raid_lockout`. Gear already names the character. Owner sees the page in preview only. Tests: rows
from another account, a revoked source or anonymous intake never show; a missing client call shows `unsupported`;
unlink deletes the derived rows (D3).

**S6.** The switches turn on each public section. Today only an operator grant can publish owned rows; S6 needs a
rule that the owner's own switch on a live link publishes their own synced rows. Migration: `show_talents`,
`show_professions`, `show_reputations`, `show_raids` (or reuse `show_collections` for reputations). Tests: each
section appears only with its switch on; switching off removes it from the page and the card on the next request.

**S7.** Lockout and guild kills sections plus the card's raid block, ready for 2026-12-09. Tests: kills from
another character on the same account never count; the guild block says it is the guild's; reset rolls over.

## 5. Later: Blizzard API mirror

When Blizzard publishes a Forever profile namespace: a server job fetches the profile only for characters that have
a live link and `page_public`, under Blizzard's API terms. Rows go into a separate table with `fetched_at`, are
deleted 30 days after fetch, on unlink, on hide and on request, and are never behind a paid tier. The page shows
those fields labelled "From Blizzard's API, <date>" next to the addon fields, and never merges the two silently.
Size M once the namespace is documented. Needs Carlos for the API client registration and a terms review.
Sweeping all characters on a realm is not part of it.

## 6. Risks

- **Self-reported data.** A link, and every synced row, can be forged in a file (ADR). A forged link can publish a
  page for someone else's character with hand-written gear. Mitigations: the wording above; a second claim freezes
  both links; the hide flow deletes the page; no rankings are built on showcase data.
- **Wording conflict.** "Verified" is banned by the ADR. If Carlos wants that word, the ADR changes first.
- **Cache.** An unpublished page or card must not stay in a warm cache. revalidatePath covers the Next cache;
  Cloudflare tag purge is CF-09 and not proven yet (SEC-01).
- **Client calls unverified.** `GetProfessions`, `GetSavedInstanceInfo` and the completion calls on Forever are
  PROBE-01 items. A missing call is `unsupported`, not zero.
- **Spoiler rule.** A freshly dropped raid item may lack 3 reports, so it shows as "Item <id>" until it has them.
  Counting an owner-published equipped item as a report is a separate decision.
- **Talent code conversion.** Mapping `talent_snapshot` node ids to the calculator's code is assumed, not tested;
  S5 starts with a fixture from a real snapshot.
- **Two pages per character.** Sightings at `/players/...`, the owner's page at `/characters/...`. Whether one
  links to the other is for Carlos; the ADR forbids mixing their data.
- **Schedule.** S3 needs S2 turned on, which needs D8. If D8 slips past 11/04, the sample page (S0, S1) is what the
  site shows on launch day.
