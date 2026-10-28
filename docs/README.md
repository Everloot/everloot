# docs/

The index to everything written down about Everloot. Start with the data policy and the
architecture map.

## Guides

| File | What it is |
|---|---|
| [`RELEASING.md`](RELEASING.md) | Addon (stable and nightly), desktop app and protocol releases, and the pull request title convention |
| [`2026-10-08-beta-client-checklist.md`](2026-10-08-beta-client-checklist.md) | What gets checked in the live client before an addon release |
| [`2026-10-18-addon-0.3.2-beta-checklist.md`](2026-10-18-addon-0.3.2-beta-checklist.md), [`2026-10-19-addon-0.3.3-beta-checklist.md`](2026-10-19-addon-0.3.3-beta-checklist.md) | The in-client checks for the 0.3.2 profession and auction reads and the 0.3.3 completion tracker |
| [`2026-10-08-release-checklist.md`](2026-10-08-release-checklist.md) | What gets checked before a site release |
| [`LAUNCH_DAY.md`](LAUNCH_DAY.md) | The launch-day sequence for 2026-11-04: the `/beta` to Live switch, the build upload, the smoke list, who does each step |
| [`BUILD_WATCH.md`](BUILD_WATCH.md) | How a new game build becomes a reviewed data pull request |
| [`TRACKER.md`](TRACKER.md) | The build list, generated from `kb/src/bridge-plan.ts` (a test keeps it in sync) |
| [`ASSETS.md`](ASSETS.md) | How Blizzard's icons, tooltip text and interface art get onto the site, and the rules for them |
| [`SEO.md`](SEO.md) | What the site does so search engines and AI assistants can find and quote it |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md), [`../ROADMAP.md`](../ROADMAP.md), [`../CHANGELOG.md`](../CHANGELOG.md) | How to contribute, what is planned, what has shipped |

## Data policy

| File | What it is |
|---|---|
| [`DATA_POLICY.md`](DATA_POLICY.md) | What we publish, what we refuse, and why |
| [`LEGACY_DATA_POLICY.md`](LEGACY_DATA_POLICY.md) | How older uploads are handled |
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

[`design/specs/`](design/specs/) holds the design for each feature, and [`design/plans/`](design/plans/)
the plans that built them, both named by date. Recent ones:

- [Everloot Desktop App](design/specs/2026-10-18-desktop-app-design.md)
- [Forever market](design/specs/2026-10-16-forever-market-design.md)
- [Platform expansion](design/specs/2026-10-18-platform-expansion-design.md)
- [Agent chat (site, companion, addon)](design/specs/2026-10-18-agent-chat-design.md)
- [World map](design/specs/2026-10-17-world-map-design.md)
- [Visual identity](design/specs/2026-10-17-visual-identity-design.md)
- [Sourced answers](design/specs/2026-10-17-sourced-answers-design.md)
- [Open-sourcing Everloot](design/specs/2026-10-16-open-source-everloot-design.md)

## Sources

| File | What it is |
|---|---|
| [`sources/LEDGER.md`](sources/LEDGER.md) | Every external source Everloot has used, linked or read, and how |
| [`sources/source-catalog.md`](sources/source-catalog.md) | The research list of candidate sources and their terms |
| [`references.md`](references.md) | Sites whose page shape we learned from, and what we do not take from them |
