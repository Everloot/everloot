# Third-party material

What Everloot ships or publishes that is not our own work, its licence, and where it is used. The
full record of every source we have used, linked or only read is
[`docs/sources/LEDGER.md`](docs/sources/LEDGER.md).

## Data

| Component | Used for | Licence | Where |
|---|---|---|---|
| [Warcraft Wiki dump, 2023-11-13](https://archive.org/details/wiki-warcraft.wiki.gg-20231113) (Internet Archive) | The lore archive: `/lore`, `/search` and the MCP lore answers | CC BY-SA 4.0; each page credits and links its source article | Imported by `kb/src/importers/wiki-*.ts` into the knowledge release |
| Battle.net API (Blizzard) | Sign-in identity, and a local cache on a maintainer's machine | Blizzard Developer API terms: no redistribution | Sign-in: `web/src/app/api/auth/bnet/`. Cache: `kb/src/blizzard/`, marked not publishable; the release build refuses it |
| [Polestar](https://github.com/fitzforge/polestar) by fitzforge | Facts about Polestar on the addons pages; we copy no code or guide text | GPL-3.0-only with a guide-pack exception | `web/src/data/polestar.ts`, and live release and issue data from the GitHub API (`web/src/lib/polestar-github.ts`) |
| Blizzard game files (client tables `ItemSparse`, `Item`, `SpellName`, `Spell`, and for the asset extractor `ChrClasses`, `ChrRaces`, `SkillLine`, `SpellMisc`, `Map`, `LoadingScreens`, `UiMap`, `UiMapAssignment`, `TaxiNodes`, `TaxiPath`, `TaxiPathNode`, the `UiMapArt*` map art tables and the `UiTextureAtlas*` interface atlas tables) from Blizzard's CDN | Per-build snapshots and diffs on a maintainer machine; published only after review, labelled unconfirmed. Item tooltip facts from `ItemSparse`/`Item` (approved 2026-10-18, `docs/DATA_POLICY.md`) are kept in private storage and shown on a page only for items 3 installs reported | Game data © Blizzard Entertainment; facts, not under our CC BY-SA licence | `kb/src/client-extract.ts`, `kb/src/client-snapshot.ts`, `kb/src/client-diff.ts` |
| [WoWDBDefs](https://github.com/wowdev/WoWDBDefs) by the wowdev contributors | Table layouts used to read the client tables | CC BY-SA 4.0 (definitions) | Fetched at extraction by `@rhyster/wow-casc-dbc`; the commit is in each snapshot manifest |
| Public pages cited for guild-family facts | One fact each, in our own words, with its link and date | Facts only; no text copied | `web/src/data/families.ts` |

World of Warcraft, Warcraft and Blizzard Entertainment are trademarks or registered trademarks of Blizzard Entertainment, Inc. in the U.S. and/or other countries.
Everloot is a fan project and is not affiliated with or endorsed by Blizzard.

## Libraries

The site ships [Leaflet](https://leafletjs.com/) 1.9.4 (BSD-2-Clause, Volodymyr Agafonkin and contributors) for the world map at `/map`. It is loaded on that page only and draws no tiles or images of its own: the map is our own shapes and, when the asset folder has them, the game's map pictures.

## Media

The site self-hosts the Geist and Geist Mono fonts by Vercel (SIL Open Font License 1.1) from the
`geist` npm package, and Google Sans Medium (Latin subset, SIL Open Font License 1.1, copyright 2025 The Google
Sans Project Authors) for the Sign in with Google button only, from the
[Google Fonts css2 API](https://fonts.googleapis.com/css2?family=Google+Sans:wght@500), as
`web/public/brand/google/GoogleSans-Medium-latin.woff2` with its licence in `web/public/brand/google/OFL.txt`. The favicon
(`web/src/app/icon.svg`) and the social card (`web/src/app/opengraph-image.tsx`) are our own. The
addon uses an icon from the game client (`Interface\Icons\INV_Misc_Coin_02`) by path; no game art
is included in this repository.

Blizzard's own icons, spell and talent tooltip text and interface frame textures may be shown on
our pages, extracted by a maintainer from unencrypted files in the local game client, stamped with
their build in a manifest and kept in Everloot's asset storage, never in this repository. They are © Blizzard Entertainment, Inc., stay Blizzard's, and are outside our CC BY-SA
and AGPL licences. Release files that include any of them say so in their licence notes. The data
downloads, API and MCP server carry ids and facts only. Item, class, buff and profession icons, item
tooltip facts and the game's map pictures were added to that rule on 2026-10-18
([`docs/DATA_POLICY.md`](docs/DATA_POLICY.md)); item tooltip facts stay in private storage that only the
site's server reads. Loading screens, race and faction emblems, spell tooltips where a spell is named and
the game's own WoW: Forever logo from its interface files were added the same day (Carlos's decision of
2026-10-18, quoted in the data policy). The logo appears only on the home page's launch banner, with "Not
affiliated with or endorsed by Blizzard Entertainment" visible on the banner, and never suggests
endorsement. Blizzard's
marketing art (key art, marketing logos, press kit, wallpapers) is never used. The talent catalog read from the client
(trait node ids, positions, ranks, gates, prerequisites, spell ids, talent names, build stamp) and
the map layer (zone rectangles, continents and instances, entrance points) may be committed as
marked game-data files with a README saying it is Blizzard's and outside our
licence. Rules and takedown contact:
[`docs/DATA_POLICY.md`](docs/DATA_POLICY.md).

### Sign-in provider marks

The sign-in buttons (`web/src/components/SocialSignIn.tsx`) and the linked sign-ins on `/account`
(`web/src/app/account/integrations.tsx`) show each provider's logo, copied unchanged from the provider's own kit on 2026-11-02 and served from our site (no provider
script or request). The marks stay their owners' trademarks; they are not ours and are outside our AGPL and CC
BY-SA licences. They name the provider on its own sign-in button and never suggest that it endorses Everloot.

| Mark | Source | Terms we follow | In this repository |
|---|---|---|---|
| Google "G" | [Sign in with Google button bundle](https://developers.google.com/static/identity/images/signin-assets.zip), file `Android + Web/SVG/Dark/Theme=Dark, Show text=Yes, Shape=Pill, Platform=Android+Web.svg`, cropped to the logo (the button outline and the text removed; the logo's paths, gradient and filters unchanged) | [Sign in with Google branding guidelines](https://developers.google.com/identity/branding-guidelines): the dark theme's colours, Google Sans Medium, its spacing, an approved label, the current "G" unaltered | `web/public/brand/google/g-logo.svg` |
| Microsoft logo | [`ms-symbollockup_mssymbol_19.svg`](https://learn.microsoft.com/en-us/entra/identity-platform/media/howto-add-branding-in-apps/ms-symbollockup_mssymbol_19.svg) | [Sign in with Microsoft branding guidelines](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-branding-in-apps): the logo unaltered, "Sign in with Microsoft", the dark-theme button | `web/src/components/ProviderLogo.tsx` |
| Twitch Glitch | [Twitch brand package](https://brand.twitch.com/uploads/Twitch-Brand.zip), file `Twitch Logos/02. Glitch/01. Twitch Purple/glitch_flat_purple.svg` | Logo Usage Guidelines (Speedrun Edition) v3.0, in the same package: core palette, no stretching, effects or low-contrast colours; [Twitch trademark guidelines](https://legal.twitch.com/en/legal/trademark/) | `web/src/components/ProviderLogo.tsx` |
| Discord symbol | [Discord brand assets](https://discord.com/branding), the Blurple symbol ([`Discord-Symbol-Blurple.svg`](https://cdn.discordapp.com/assets/content/a736b95923ddbc155e828651c92471292e40727655d770a06cec89c48ba0b41f.zip)) | The same page: the logo not edited, recoloured, distorted or reconfigured, digital use only, no implied sponsorship | `web/src/components/ProviderLogo.tsx` |

Google and the Google logo are trademarks of Google LLC. Microsoft and the Microsoft logo are trademarks of the
Microsoft group of companies. Twitch and the Glitch logo are trademarks of Twitch Interactive, Inc. Discord and the
Discord logo are trademarks of Discord Inc. Battle.net's button has no logo: Blizzard publishes no licence for one.

## Dependencies

npm packages, production dependencies only, checked with `license-checker-rseidelsohn --production`
on 2026-10-16 from a Windows install (each platform installs its own prebuilt binaries):

| Package | Licences |
|---|---|
| `kb` | MIT 126 (including `@rhyster/wow-casc-dbc`, added 2026-10-17), ISC 11, Apache-2.0 3, BSD-3-Clause 3, BSD-2-Clause 2, Python-2.0 1 (`argparse`), BlueOak-1.0.0 1 (`sax`), MIT OR WTFPL 1 (`expand-template`, used under MIT), MIT OR Apache-2.0 OR BSD-2-Clause 1 |
| `web` | MIT 96, ISC 9, Apache-2.0 3, BSD-3-Clause 3, BSD-2-Clause 1, CC-BY-4.0 1 (`caniuse-lite` data), 0BSD 1 (`tslib`), OFL-1.1 1 (`geist`), Apache-2.0 AND LGPL-3.0-or-later 1 (`@img/sharp-win32-x64`: sharp's prebuilt libvips image library; every platform gets its own LGPL-3.0-or-later libvips binary, such as `@img/sharp-libvips-linux-x64` on Vercel) |
| `companion` | MIT 88, ISC 7, BSD-3-Clause 2, BSD-2-Clause 1, Unlicense 1 (`fast-sha256`) |

The checker lists each of our own three packages as `UNLICENSED` because they are marked
`private` in `package.json`; they are AGPL-3.0-only like the rest of the repository. Every other
licence above can be combined with the AGPL-3.0.

The addon is plain Lua with no third-party libraries.
