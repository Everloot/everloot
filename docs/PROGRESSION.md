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

The guild follow-up has one entry point:

```ts
const progress = await loadRosterProgression(
  members.map(member => ({ ...member, region: guild.region })),
);
```

This accepts `ArmoryMember` rows with the guild's region. It uses the same privacy
rule: members other than the viewer's own consented characters appear in no data.
It reads the catalogue and account links once per roster. Keep the adopting page
dynamic; never put this viewer-dependent result in a shared cache. The guild page
is intentionally not wired in this change. `ProgressionMatrix` currently renders
character counts; roster summaries expose their own member lists for that follow-up.

## Release information

There is no complete release schedule in the repository. There is an existing
three-raid announcement in `kb/news/wow-forever-launch-week-checklist-nov-4.md`,
`kb/curated/blue-writeups/us-30552119.md` and the blue-post snapshot: Barrow Deeps,
Hyjal Summit and Onyxia's Lair on December 9. The matrix links the cited
[Blizzard raid overview](https://news.blizzard.com/en-us/article/24303009/world-of-warcraft-forever-raid-overviewlocations-raid-sizes-and-attunement)
separately. It does not manufacture dates or phases for any file entry, nor use a
date as evidence that an instance has opened. File presence can mean unused or
test content, as well as future content.
