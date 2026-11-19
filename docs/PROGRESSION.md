# Character and roster progression

`kb/src/progression.ts` is a pure, lifetime progression model. It reads the same
checked-in client encounter extract, map names, map entrances and player agreement
snapshot as the instance table generator. It intentionally keeps entries that the
addon's agreement filter leaves out, including test maps. This checkout has 41
encounter-bearing instance IDs, not the 62 described in the original brief.

Order is Dungeons, Raids, World bosses, then the instance order in the files
(numeric map ID); bosses retain file order, deduplicated by encounter ID. An entry
without a known name prints its map ID. An entry without a known type sits in
Dungeons with an explicit type-unconfirmed label. World-boss groups and their
unconfirmed meaning match `web/scripts/build-instance-data.ts`.

`progressionCatalogue(facts)` marks an instance open when any public upload reports
its entrance or a successful encounter. This is evidence of observation, not
agreement on a name, position or boss list. Wipes do not count. Without evidence it
says "not seen open yet"; if public storage failed (`facts === null`), availability
is unknown. Private histories never contribute to public availability.

`characterProgression(catalogue, kills)` counts distinct encounters within each map
across all difficulties. States are cleared (all bosses), partial (some), none
(known history, no matching kills), and no data (no permitted history). The newest
matching kill day is UTC. Null history differs from an empty array.
`rosterProgression(catalogue, roster)` lists members per state and counts cleared
and partial members without treating missing history as zero progress.

## Loaders and privacy

`loadCharacterProgression(region, slug)` in `web/src/lib/progression.ts` is a
request-scoped loader for the character sheet. It returns `instances` and `links`
only for instance pages the existing route can serve. It does not cache private
results. Failed reads keep the complete catalogue with no character data.

Issue [#1275](https://github.com/Everloot/everloot/issues/1275) remained open and
undecided when this feature was implemented. Boss history remains private: the
signed-in account must own the armory association, the character must still be
visible and linked, and the existing boss-kill RPC must return consent and a stored
capture. Both private sync and boss-kill sync gates remain required. Frozen links,
revoked consent, missing captures and other viewers get no history. No migration,
collection switch or publication permission changes here. Blizzard's API gives no
encounter data for Forever; the histories are the Everloot addon's own uploads.

## Guild completion and score

`kb/src/guild-progression.ts` counts a boss when at least N distinct roster
characters hold that encounter in that map. Dungeons need 5, world bosses 40,
and raids use `RAID_SIZES`. Repeated kills and difficulties do not add members.
Unreadable histories count as not holding the kill. All bosses counted means
cleared, some means partial, and zero means none (including an empty instance).
Unknown instance types and unknown raid sizes never count.

The hand-kept map-id table cites Blizzard's raid overview for Onyxia (249, 40).
It also announces Barrow Deeps (10) and Hyjal Summit (20), but this extract has
neither map id; adding an invented mapping would assign sizes to the wrong content.
Classic fallbacks are Molten Core (409, 40), Blackwing Lair (469, 40), Zul'Gurub
(309, 20), Ruins of Ahn'Qiraj (509, 20), Temple of Ahn'Qiraj (531, 40), and
Naxxramas (533, 40). The other Naxxramas map is a dungeon in the files, not this
classic raid. Scarlet Enclave (2856) is unknown. Future unknown raids stay null.

`guildProgressionScore(catalogue, rosterProgression)` gives N points per counted
boss and a clear bonus of total bosses times N. Only observed-open instances
score; not-seen-open and unavailable public facts earn zero. Worked example:
a cleared two-boss dungeon earns 2 x 5 + 2 x 5 = 20; one counted boss in an
incomplete 40-player raid earns 40. Together the score is 60. Member order and
kill order do not change the score. Historical kills need not be from the same run.

`loadGuildProgression` uses the same owner, consent and hide checks as character
progression and deduplicates roster characters. The dynamic guild page places its
section after the population summary and extends `ProgressionMatrix` with guild
counts and thresholds. Nothing private is put in a shared cache.

The hub's request-scoped `loadGuildProgressionRanking` considers guilds of the
viewer's linked characters, rechecks guild hides and current rosters, and ranks
positive scores, descending with region/slug ties. Under the owner-only rule no
other guild can score: every counted kill must come from one of those linked
characters. Anonymous viewers and views without positive scores get no board.
This is a ranking within the viewer's permitted histories, not a public standing.
Public rankings still need the #1275 publication decision; the existing two-install
raid ladder remains separate and keeps its existing rules.

## Release information

There is no complete release schedule in the repository. There is an existing
three-raid announcement in `kb/news/wow-forever-launch-week-checklist-nov-4.md`,
`kb/curated/blue-writeups/us-30552119.md` and the blue-post snapshot: Barrow Deeps,
Hyjal Summit and Onyxia's Lair on December 9. The matrix links the cited
[Blizzard raid overview](https://news.blizzard.com/en-us/article/24303009/world-of-warcraft-forever-raid-overviewlocations-raid-sizes-and-attunement)
separately. It does not manufacture dates or phases for any file entry, nor use a
date as evidence that an instance has opened. File presence can mean unused or
test content, as well as future content.
