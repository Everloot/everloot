# Roadmap

What we are working on, and what you can pick up. Open work is in the
[issues](https://github.com/Everloot/everloot/issues); those labelled `good first issue` and
`help wanted` are open for anyone.

Two documents hold the detail. The architecture is described in
[#57, the north star](https://github.com/Everloot/everloot/issues/57): one game-data layer keyed by
in-game ID, a player-data pipeline, a public read API with access tiers, community data packs, an addon
directory, a shared visual kit, then ads and apps. The backlog is in
[`docs/2026-10-28-platform-gap-register.md`](docs/2026-10-28-platform-gap-register.md), with an ID per
item (`REL-01`, `CF-04`, `HUB-P01` and so on) that issues and pull requests can cite.
What has shipped is in [`CHANGELOG.md`](CHANGELOG.md).

## Now: after the launch (WoW: Forever, 2026-11-04)

- **Addon 0.3.21** (2026-11-06), on [CurseForge](https://www.curseforge.com/wow/addons/everloot) and the
  [releases page](https://github.com/Everloot/everloot/releases), with a nightly pre-release built from `main`.
  Its release notes say which changes have not yet been seen in the Forever client; those checks are still open.
- **Everloot Desktop App 0.1.20** (2026-11-06), unsigned builds for Windows, macOS and Linux. It keeps the
  addon up to date and sends private sync for the characters you linked.
- **The post-launch sweep.** Issues labelled `night-shift` are small, self-contained fixes to the database
  pages, the addon window, the Desktop App and the documentation, each taken as one reviewed pull request.
- **Data from the first week.** Wrong data reports ([#8](https://github.com/Everloot/everloot/issues/8)),
  damaged lore pages ([#7](https://github.com/Everloot/everloot/issues/7)), lost auction deposits
  ([#6](https://github.com/Everloot/everloot/issues/6)) and profession names that arrive only in the client's
  language ([#811](https://github.com/Everloot/everloot/issues/811)).

### Shipped since launch

Addon 0.3.16 to 0.3.21 (quest, vendor and recipe capture on the live client, item tooltips that name their
drop sources), Desktop App 0.1.18 to 0.1.20 (addon self-update, private sync), and on the site private sync of
linked characters and gear rankings behind a flag. The open data export, listed here as Next until this
revision, is live at `/database/download` ([`docs/OPEN_DATA.md`](docs/OPEN_DATA.md)). Each is dated in
[`CHANGELOG.md`](CHANGELOG.md).

## Next

In the order [#57](https://github.com/Everloot/everloot/issues/57) sets:

1. **One game-data layer.** Everything keyed by in-game ID plus game version and build, pages rendered by
   ID, icons from Blizzard's media endpoints on our own CDN. The schema is agreed on paper before more pages
   are built.
2. **The player-data pipeline.** Upload, validation, raw storage, then normalized output; the public pages,
   the apps and the MCP server read only the normalized output.
3. **The public read API and its tiers.** The free tier (site, apps, MCP) stays read-only and rate limited;
   partner keys get higher limits and extra endpoints, issued and revoked by the maintainer.
4. **Community data packs.** A documented format, submitted by pull request or upload, validated
   automatically and approved by a maintainer before anything goes public. Sharing observed data with
   [Polestar](https://github.com/fitzforge/polestar) ([#9](https://github.com/Everloot/everloot/issues/9))
   fits here: its guides could use Forever data, and its players could add to ours.
5. **The addon directory.** Open-source Forever addons ranked by public traction, with public rules and no
   paid placement; the ranking and listing rules still need a page
   ([#988](https://github.com/Everloot/everloot/issues/988)) and a listing form
   ([#950](https://github.com/Everloot/everloot/issues/950)).
6. **The visual kit.** Shared spell icon, talent tree, class colours and item-quality borders, so every page
   reads as one site.

Also next: a newer lore archive, if the Warcraft Wiki allows a current dump.

## Later

- **Ads**, on our own pages only, with no paywall and none on pages with Blizzard art, as
  [#57](https://github.com/Everloot/everloot/issues/57) sets out.
- **Mobile apps.** An Android app on Google Play first, then iOS on the App Store: the database, the talent
  calculator and the raid builder in your pocket, and uploads from the desktop companion without a PC
  nearby. Free like the site; an account only adds sync. Code will live in its own repositories
  (`Everloot/android`, `Everloot/ios`).
- Recipe windows from real crafts, and the gaps listed in
  [`docs/sources/source-catalog.md`](docs/sources/source-catalog.md).
