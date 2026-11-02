# Public character pages: decision sheet

Date: 2026-11-02. For the owner. Each line is one choice, with the default we recommend and what follows from it.
Answer them together and the [go-live checklist](2026-11-02-showcase-go-live.md) can run. Background: the
[showcase plan](design/2026-11-01-character-showcase-plan.md) and the
[policy draft](design/2026-11-01-public-character-policy-draft.md).

Turning this on means two switches, `EVERLOOT_CHARACTER_LINKS` and `EVERLOOT_SHOWCASE`. Players can then link
their own characters on /account and, if they choose, give one a public page with its name, level, race, class,
faction and realm. A new link is private. Nothing else about the character is shown.

| # | Decision | Recommended | What follows |
|---|---|---|---|
| 1 | Accept the [policy draft](design/2026-11-01-public-character-policy-draft.md) as the public-profile contract | Accept as written | Its section moves into `docs/DATA_POLICY.md` after "Profiles", with the D8 text filled in. Gear, talents and the other sections still need their own text later. |
| 2 | Search engines | No for now: every character page stays `noindex` | No code change. Pages still unfurl in Discord and on social sites. Revisit after a month of disputes and hide requests. Saying yes later is a small PR (the API refuses `indexable: true` today). |
| 3 | D8: dispute contact and reply time for frozen characters | `hello@everloot.app`, a reply within 7 days, the character stays frozen until then | The frozen notice on /account, the policy and /privacy name that address and that time. Choose a time you can keep: it is a promise to players. |
| 4 | The /privacy paragraph | Accept the [proposed text](2026-11-02-showcase-privacy-text.md) | It goes live in the same deploy as the switches, so the page never describes something that is not on, or the other way round. |
| 5 | Migration `20261021190000_character_links.sql` in production | You run the read-only readback in the checklist; every row must be `t` | If any row is `f`, stop: apply the migration first (it is safe to run twice) and read back again. Agents cannot reach the production database. |
| 6 | D6: a handle or account on the page | No | The page names the character only, never the player behind it. |
| 7 | Player page and character page linking to each other | No for now | A sighting page (`/players/...`) and a linked page (`/characters/...`) stay separate, as the identity ADR asks. The character page keeps its link to the hide form. |
| 8 | Caching | Keep: every page and card is drawn fresh, `no-store` | Turning a page off removes it at once. Revisit only if rendering cost shows up. |
| 9 | Both switches in one deploy | Yes | A new link is private, so linking and pages can start together. Turning on only links first is also safe, but adds a second deploy for little gain. |
| 10 | When | A weekday after launch week (from 2026-11-09) when you can watch the first day | The checklist's day-one watch needs about four checks spread over the day. |

Not part of this go-live: planned builds on the page (S4), gear, talents and the other sections (S5 to S7). Each
has its own switch or migration and its own decision later.

## Your answer

Copy this into the go-live issue or PR and change what you disagree with:

```
1 accept  2 noindex  3 hello@everloot.app, 7 days  4 accept  5 readback all t (date)
6 no  7 no  8 keep  9 one deploy  10 <date>
```
