# docs/

The index to everything written down about Everloot. Start with the data policy and the
architecture map.

## Guides

| File | What it is |
|---|---|
| [`WORKFLOWS.md`](WORKFLOWS.md) | Every GitHub Actions workflow: what starts it, what it writes, what a failure means |
| [`RELEASING.md`](RELEASING.md) | Addon (stable and nightly), desktop app and protocol releases, and the pull request title convention |
| [`2026-10-08-beta-client-checklist.md`](2026-10-08-beta-client-checklist.md) | What gets checked in the live client before an addon release |
| [`2026-10-18-addon-0.3.2-beta-checklist.md`](2026-10-18-addon-0.3.2-beta-checklist.md), [`2026-10-19-addon-0.3.3-beta-checklist.md`](2026-10-19-addon-0.3.3-beta-checklist.md) | The in-client checks for the 0.3.2 profession and auction reads and the 0.3.3 completion tracker |
| [`2026-10-08-release-checklist.md`](2026-10-08-release-checklist.md) | What gets checked before a site release |
| [`LAUNCH_DAY.md`](LAUNCH_DAY.md) | The launch-day runbook (historical) for 2026-11-04: the `/beta` to Live switch, the build upload, the smoke list, who does each step |
| [`2026-10-28-live-client-capability-checklist.md`](2026-10-28-live-client-capability-checklist.md) | The current in-game probe list. Prepared on 2026-10-28 and not run, so every row stays unverified until someone runs it in the client |
| [`2026-10-28-platform-gap-register.md`](2026-10-28-platform-gap-register.md) | The long-form backlog: platform gaps in the approved order, and which of them wait on a live check |
| [`BUILD_WATCH.md`](BUILD_WATCH.md) | How a new game build becomes a reviewed data pull request |
| [`BUILD_REFRESH.md`](BUILD_REFRESH.md) | The hand steps after that pull request: tests, perks, art, names, counts, the asset URL, the exports |
| [`TRACKER.md`](TRACKER.md) | The build list, generated from `kb/src/bridge-plan.ts` (a test keeps it in sync) |
| [`ASSETS.md`](ASSETS.md) | How Blizzard's icons, tooltip text and interface art get onto the site, and the rules for them |
| [`SEO.md`](SEO.md) | What the site does so search engines and AI assistants can find and quote it |
| [`ENVIRONMENT.md`](ENVIRONMENT.md) | Every variable and secret the project reads, names only, and which surface sets each |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md), [`../ROADMAP.md`](../ROADMAP.md), [`../CHANGELOG.md`](../CHANGELOG.md) | How to contribute, what is planned, what has shipped |

## Data policy

| File | What it is |
|---|---|
| [`DATA_POLICY.md`](DATA_POLICY.md) | What we publish, what we refuse, and why |
| [`LEGACY_DATA_POLICY.md`](LEGACY_DATA_POLICY.md) | How older uploads are handled |
| [`OPEN_DATA.md`](OPEN_DATA.md) | How a maintainer builds the open-data folder (`npm run kb -- open-data`), uploads it, and what the download page lists. Only facts three installs agree on |
| [`LEGACY_PERKS.md`](LEGACY_PERKS.md) | One build's Legacy perk trees, read from the game files and kept out of the player-reported data |
| [`TALENT_CATALOG.md`](TALENT_CATALOG.md) | The talent catalog read from the game files |
| [`GUIDES.md`](GUIDES.md) | The contract every guide meets: review, versions and history, plans, sources |

## Architecture

| File | What it is |
|---|---|
| [`architecture.md`](architecture.md) | The service and data map |
| [`DATA_PLACEMENT.md`](DATA_PLACEMENT.md) | Where each kind of data is stored, who may write and read it |
| [`2026-10-18-database-taxonomy-research.md`](2026-10-18-database-taxonomy-research.md), [`2026-10-18-client-data-placement.md`](2026-10-18-client-data-placement.md) | How other game databases map entities, and where each table in the Forever client fits in Everloot |
| [`everloot-wow-architecture-audit.md`](everloot-wow-architecture-audit.md) | The datamining and community-data audit that led to the game-file layer |
| [`2026-10-09-public-mcp-hosting-options.md`](2026-10-09-public-mcp-hosting-options.md) | Where the public MCP endpoint can run |
| [`2026-10-09-recipe-capture-options.md`](2026-10-09-recipe-capture-options.md), [`2026-10-10-recipe-windows-design.md`](2026-10-10-recipe-windows-design.md) | How recipe difficulty is captured |
| [`2026-10-17-talent-share-code.md`](2026-10-17-talent-share-code.md), [`2026-10-18-raid-share-code.md`](2026-10-18-raid-share-code.md) | The talent and raid share link formats |
| [`2026-10-18-mcp-listings.md`](2026-10-18-mcp-listings.md) | Listing the MCP server: the registry, the Claude and ChatGPT directories, the words every listing uses |

## Design specs and plans

[`design/`](design/) holds the notes that sit next to the spec and plan folders.
[`design/specs/`](design/specs/) holds the design for each feature, and
[`design/plans/`](design/plans/) the plans that built them. Both of those folders are
listed by directory and named by date, so the files inside them are not repeated here.
Recent specs:

- [Everloot Desktop App](design/specs/2026-10-18-desktop-app-design.md)
- [Forever market](design/specs/2026-10-16-forever-market-design.md)
- [Platform expansion](design/specs/2026-10-18-platform-expansion-design.md)
- [Agent chat (site, companion, addon)](design/specs/2026-10-18-agent-chat-design.md)
- [World map](design/specs/2026-10-17-world-map-design.md)
- [Visual identity](design/specs/2026-10-17-visual-identity-design.md)
- [Sourced answers](design/specs/2026-10-17-sourced-answers-design.md)
- [Open-sourcing Everloot](design/specs/2026-10-16-open-source-everloot-design.md)

Notes directly under [`design/`](design/):

| File | What it is |
|---|---|
| [`design/2026-11-01-character-showcase-plan.md`](design/2026-11-01-character-showcase-plan.md) | Plan for public character pages and a share card. The note says it is a plan and contains no code |
| [`design/2026-11-01-public-character-policy-draft.md`](design/2026-11-01-public-character-policy-draft.md) | Accepted wording for public character pages. The same section is now in [`DATA_POLICY.md`](DATA_POLICY.md), and that copy is the one in effect |
| [`design/2026-11-02-everloot-score.md`](design/2026-11-02-everloot-score.md) | The score formula as a library. The note says nothing on the site shows a score |
| [`design/2026-11-02-profiles-score-rankings-plan.md`](design/2026-11-02-profiles-score-rankings-plan.md) | Plan for player profiles, the score and a rankings hub. The note says it contains no code |
| [`design/2026-11-05-addon-item-decisions-analysis.md`](design/2026-11-05-addon-item-decisions-analysis.md) | Notes from a reel on item decisions and the price tooltip, and a proposed order of work. No runtime change |
| [`design/2026-11-05-addon-price-verification.md`](design/2026-11-05-addon-price-verification.md) | Check of the price tooltip on one private candidate, keeping addon 0.3.17 and the minimap drawer |
| [`design/2026-11-07-profile-pipeline.md`](design/2026-11-07-profile-pipeline.md) | How linked characters are digested on a schedule. The first step is behind `EVERLOOT_LEADERBOARDS`, off by default |

## Sources

[`sources/`](sources/) holds three files, named below. [`references.md`](references.md) sits beside that folder.

| File | What it is |
|---|---|
| [`sources/LEDGER.md`](sources/LEDGER.md) | Every external source Everloot has used, linked or read, and how |
| [`sources/source-catalog.md`](sources/source-catalog.md) | The research list of candidate sources and their terms |
| [`sources/2026-10-27-class-legacy-dungeon-source-audit.md`](sources/2026-10-27-class-legacy-dungeon-source-audit.md) | Whether the sources already allowed can back the class, Legacy and dungeon facts. Read-only; nothing was added to the client tables |
| [`references.md`](references.md) | Sites whose page shape we learned from, and what we do not take from them |

## Folders

| Folder | What it holds |
|---|---|
| [`superpowers/plans/`](superpowers/plans/) | Implementation plans. The Chat workspace plan opens with its goal and the specs it follows; the armory plan opens the same way |
| [`superpowers/specs/`](superpowers/specs/) | Design notes for Chat dictation, item cards and projects, a sharper Desktop, MCP parity, the sign-in card, and the addon window's gold ledger |
| [`evals/`](evals/) | Question evals and written-answer evals. A question eval counts how names resolved; a written-answer eval scores a reply against an answer key |
| [`fixtures/`](fixtures/) | Shared test vectors for the talent spend-order token and the plan-link fragment, in `talent-order-v1.json` |
| [`media/`](media/) | Images the README and the notes embed: the logos, the home, talent, raid, map and changes captures, the Desktop App overview, and three Chat key-card shots |

## Archive: dated notes

Dated notes at the top of `docs/` that are not already named above. The status is what that note says: done, superseded, or still open.

### October 2026

| Date | Note | Status |
|---|---|---|
| 2026-10-21 | [Everloot 0.3.10: map positions, launch-day check](2026-10-21-addon-0.3.10-launch-checklist.md) | still open: the beta closed before it ran, and no result is recorded |
| 2026-10-21 | [Connecting a Chat provider by signing in](2026-10-21-chat-connect-sign-in.md) | still open: nothing in the note is built |
| 2026-10-21 | [House cleanup, 2026-10-21](2026-10-21-house-cleanup.md) | done |
| 2026-10-21 | [Lane closeout: the addon records vignettes, entrances and encounters](2026-10-21-lane-addon-records-closeout.md) | done |
| 2026-10-21 | [Lane closeout: the addon value loop, first slice](2026-10-21-lane-addon-value-loop-closeout.md) | done |
| 2026-10-21 | [Coverage engine lane closeout](2026-10-21-lane-coverage-engine-closeout.md) | done |
| 2026-10-21 | [Fact states lane closeout](2026-10-21-lane-fact-states-closeout.md) | done |
| 2026-10-21 | [Lane closeout: item numbers players report](2026-10-21-lane-item-numbers-closeout.md) | done |
| 2026-10-21 | [Launch surfaces lane: closeout](2026-10-21-lane-launch-surfaces-closeout.md) | done |
| 2026-10-21 | [Loot tables lane closeout](2026-10-21-lane-loot-tables-closeout.md) | done |
| 2026-10-21 | [Lane closeout: the map and the instances](2026-10-21-lane-map-instances-closeout.md) | done |
| 2026-10-21 | [Lane 5 closeout: the model catalogue behind Chat](2026-10-21-lane-model-catalogue-closeout.md) | done |
| 2026-10-21 | [Lane closeout: the public feed is readable again](2026-10-21-lane-public-feed-closeout.md) | done |
| 2026-10-22 | [Coverage MCP tool closeout](2026-10-22-lane-coverage-mcp-closeout.md) | done |
| 2026-10-22 | [Coverage score lane closeout](2026-10-22-lane-coverage-score-closeout.md) | done |
| 2026-10-22 | [Idle cron and internal coverage report closeout](2026-10-22-lane-idle-cron-coverage-report-closeout.md) | done |
| 2026-10-22 | [Upload index insert closeout](2026-10-22-lane-intake-index-closeout.md) | done |
| 2026-10-22 | [Item facts lane closeout](2026-10-22-lane-item-facts-closeout.md) | done |
| 2026-10-22 | [Wave 5 lane E: MCP item numbers and settled counts](2026-10-22-lane-mcp-item-coverage-closeout.md) | done |
| 2026-10-22 | [Open data export lane closeout](2026-10-22-lane-open-data-export-closeout.md) | done |
| 2026-10-22 | [Plateau and spot check lane closeout](2026-10-22-lane-plateau-spot-check-closeout.md) | done |
| 2026-10-22 | [Recheck cut-off lane closeout](2026-10-22-lane-recheck-cutoff-closeout.md) | done |
| 2026-10-22 | [Settled list and uploader filter closeout](2026-10-22-lane-settled-list-closeout.md) | done |
| 2026-10-22 | [Lane closeout: instance pages in search, the quest filter, the name count](2026-10-22-lane-sitemap-names-closeout.md) | done |
| 2026-10-22 | [Lane C, wave 5: version routing closeout](2026-10-22-lane-version-routing-closeout.md) | done |
| 2026-10-22 | [Weapon damage lane closeout](2026-10-22-lane-weapon-damage-closeout.md) | done |
| 2026-10-24 | [Connected planners](2026-10-24-connected-planners.md) | still open: the in-game layout is unchecked |
| 2026-10-24 | [Publishing the coverage expected counts](2026-10-24-coverage-publication.md) | done: [`LAUNCH_DAY.md`](LAUNCH_DAY.md) records the upload for build 70707 |
| 2026-10-24 | [Planner Alpha: live-client verification](2026-10-24-planners-live-client-checklist.md) | still open: the note's status is pending |
| 2026-10-25 | [Chat workspace: migration and activation](2026-10-25-chat-workspace-activation.md) | still open: the apply steps are not marked done |
| 2026-10-27 | [C05 pilots: review checklist](2026-10-27-c05-pilot-review.md) | still open: the drafts are not reviewed or published |
| 2026-10-27 | [Community guide drafts: migration and activation](2026-10-27-guide-submissions-activation.md) | still open: activation is blocked |
| 2026-10-27 | [Profiles: migration and activation](2026-10-27-profiles-activation.md) | still open: the migration and the switch are not marked on |
| 2026-10-27 | [Saved builds: activation](2026-10-27-saved-builds-activation.md) | still open: the migration is in; the switch is not marked on |
| 2026-10-28 | [Moving the site from Vercel to Cloudflare Workers](2026-10-28-cloudflare-workers-migration.md) | still open: the note stops at the spike, before the domain switch |
| 2026-10-28 | [ECON-E01 economy terminology audit](2026-10-28-economy-terminology-audit.md) | still open: F1, F2, F3 and F5 remain |
| 2026-10-28 | [Desktop and platform readiness handoff](2026-10-28-readiness-handoff.md) | still open: several items remain after the source pass |
| 2026-10-30 | [Social sign-in](2026-10-30-social-sign-in.md) | done |
| 2026-10-31 | [Addon capture and Home window acceptance](2026-10-31-addon-capture-acceptance.md) | still open: not run in game |
| 2026-10-31 | [Launch acceptance: Desktop 0.1.14 and addon 0.3.15](2026-10-31-launch-acceptance.md) | still open: the cases are left pending |

### November 2026

| Date | Note | Status |
|---|---|---|
| 2026-11-02 | [ChatGPT launch readiness](2026-11-02-chatgpt-launch-readiness.md) | still open: the acceptance table is not passed |
| 2026-11-02 | [What an Overwolf developer account could do for Everloot](2026-11-02-overwolf-options.md) | done: research only, no account was opened |
| 2026-11-02 | [Public character pages: decision sheet](2026-11-02-showcase-decisions.md) | done; item 7 superseded by one character page |
| 2026-11-02 | [Public character pages: go-live checklist](2026-11-02-showcase-go-live.md) | done, as [the private-sync note](2026-11-06-private-sync-switch-on.md) records |
| 2026-11-02 | [/privacy: proposed text for linked characters and their public pages](2026-11-02-showcase-privacy-text.md) | superseded by [the privacy page](../web/src/app/privacy/page.tsx) |
| 2026-11-03 | [Catalog kinds: what to check after the merge](2026-11-03-catalog-kinds-release.md) | still open: the after-merge checks have no result recorded |
| 2026-11-03 | [What the Forever client holds for localized names](2026-11-03-localized-names-recon.md) | done |
| 2026-11-06 | [Private sync and published sections: switch-on steps](2026-11-06-private-sync-switch-on.md) | still open: talent builds are not sent, and the Desktop App release is still named as missing |
