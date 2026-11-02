# Public character pages: draft DATA_POLICY section

Date: 2026-11-01. Status: **draft, not in effect.** Written for slice S3 of the
[character showcase plan](2026-11-01-character-showcase-plan.md). Nothing here applies until the maintainer accepts
it and moves the section below into [DATA_POLICY](../DATA_POLICY.md), after "Profiles". The code it describes is
behind `EVERLOOT_SHOWCASE`, which is off in production.

The [owned-character identity ADR](specs/2026-10-28-owned-character-identity.md) (section 5) says no route sets or
reads `character_visibility` until a public-profile contract is accepted. The S3 code does both, behind the flag.
Accepting this section is that contract for identity-only pages; gear, talents and the other sections need their
own text when S6 lands.

---

## Public character pages

A signed-in player who has linked one of their characters (Linked characters, on /account) can give it a public
page at `/characters/<ruleset>/<realm>/<name>`. The page holds the player's own data from their own addon file. It
holds nothing about anyone else.

- **What a page shows.** The character's name, level, race, class, faction and realm, as the addon file sent them
  when the character was last linked, and the date of that upload, worded "From the player's own addon upload,
  <date>". Nothing comes from the player pages, the census, other players' uploads or Blizzard. Gear, talents,
  professions, reputations, raids and collections are not shown.
- **What it never shows.** The BattleTag, the email address, the account, a profile handle, API keys, the
  character's game id, or the hashes a link is stored under.
- **Off until the player turns it on.** A new link is private. The page exists only while the player has "Public
  page" on for that character. Turning it off, unlinking the character or deleting the account removes the page and
  its share cards at once; the address answers 404 like any unknown character.
- **A link is not proof.** A link shows that the account holder also had an addon file in which the character typed
  a code. It is not checked with Blizzard, and the row can be written by hand. The page says the data is
  self-reported and not checked against Blizzard, and it never calls the character verified or owned.
- **Disputes.** When a second account links the same character, the character is frozen on every account that
  holds it and has no public page until we settle it. [Contact and response time: decision D8.]
- **Hiding.** Anyone can hide a character through the player-page hide form, without an account. A hidden character
  cannot be linked and has no public page, whoever linked it. Each character page links to the form.
- **Share cards.** Each page has two images, 1200x630 for link previews and 1080x1080 to download, drawn from the
  same fields as the page. Text and shapes only: no game art and no Blizzard marks.
- **Search engines.** Every character page asks search engines not to index it. Players cannot change this yet.
- **Caching.** Everloot draws the page and cards fresh on each request and keeps no copy. A copy that a link-preview
  service (Discord, X and others) has already fetched is outside our control and may stay with that service.
- **Player pages are separate.** A player page (`/players/...`) shows what other players' addons saw. A character
  page shows what the linked player sent. Neither adds data to the other.

---

## Decisions before `EVERLOOT_SHOWCASE=1`

1. **Accept this section** as the public-profile contract the identity ADR asks for, or change it.
2. **Indexing.** Whether a player may opt a page into search engines. Until then the API refuses `indexable: true`,
   the account page offers no such switch, and every page is noindex whatever the column holds.
3. **D8.** The dispute contact and response time for frozen characters (the placeholder above).
4. **D6.** No handle or account shows on a page. Change only if D6 is accepted.
5. **Player-page link.** Whether `/players/...` and `/characters/...` link to each other. Today the character page
   links only to the hide form.
6. **Caching.** Pages and cards are rendered per request with `no-store`, so switching a page off leaves no warm
   copy. Revisit once Cloudflare tag purge (CF-09) is proven, if the rendering cost matters.
7. **Privacy page.** /privacy needs a matching paragraph when this section is accepted.
8. **Prerequisites.** `EVERLOOT_CHARACTER_LINKS=1` and a readback of `20261021190000_character_links.sql` on the
   production database (S2's own conditions); the visibility endpoint answers 404 unless both flags are on.

The [decision sheet](../2026-11-02-showcase-decisions.md) puts these with a recommended answer each; the
[go-live checklist](../2026-11-02-showcase-go-live.md) and the [proposed /privacy text](../2026-11-02-showcase-privacy-text.md)
are the steps after them.
