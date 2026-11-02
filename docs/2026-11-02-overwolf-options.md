# What an Overwolf developer account could do for Everloot (2026-11-02)

Research for Carlos. I did not sign up, sign in, submit a form or send anything. I read the official
pages linked below on 2026-11-02. Anything marked **unverified** I could not confirm on an official page;
check it before relying on it. Overwolf owns CurseForge, so a single Overwolf developer account covers both.

## Short answer

- The CurseForge **read** API can't power `/addons/popular` as it is, because the terms forbid caching.
  Keep D8 (link only). The cheap next step is to email Overwolf and ask for written permission. A draft is below.
- On the **author** side, the repo already uses the one thing that matters: CI uploads each tagged
  release to CurseForge. What remains is filling in the project page and opting into rewards.
- **ow-electron** gives the Desktop App nothing it needs for WoW: Forever, and since 1 November 2026
  Overwolf approves only apps that carry Overwolf monetization. Don't move `desktop/`, before or after launch.

## 1. CurseForge read API

**Getting a key.** There are two routes:

- Game studios create a game in the CurseForge for Studios console (console.curseforge.com) and get a
  key there. The REST docs say that registered console accounts which aren't game developers and didn't
  request a key are deleted ([REST docs](https://docs.curseforge.com/rest-api/)).
- Third-party tools like Everloot apply through a form, and the Overwolf team reviews each application. The form asks for
  contact details, a project description, links and the expected API use. Reviewers weigh the effect on
  authors' earnings, the load on CurseForge servers and the CDN, and whether authors consent to third-party
  distribution. Approved keys arrive by email
  ([how to apply](https://support.curseforge.com/support/solutions/articles/9000208346-about-the-curseforge-api-and-how-to-apply-for-a-key)).

The key Everloot already holds (`CF_API_KEY`) is an **upload** token for `wow.curseforge.com`. It is not
an `api.curseforge.com` read key, and the two must not be mixed up.

**What it returns.** `GET https://api.curseforge.com/v1/mods/{id}` with an `x-api-key` header returns,
per addon: `name`, `slug`, `summary`, `authors` (id, name, url), `logo` and `screenshots` (with
`thumbnailUrl`), `links` (website, wiki, issues, source), `categories`, `downloadCount`,
`thumbsUpCount`, `rating`, `gamePopularityRank`, `dateCreated` / `dateModified` / `dateReleased`, and
`latestFiles` / `latestFilesIndexes` (file name, release type, and the `gameVersion` each file supports).
Search pages hold at most 50 results, and index plus page size can't exceed 10,000. The docs state no rate
limit ([REST docs](https://docs.curseforge.com/rest-api/)). **Unverified:** whether a file tagged for
Forever `1.60.1` (upload game version 17053) shows up as a distinct `gameVersion` on the read side, and
the WoW `gameId` (get it from `GET /v1/games`).

**Terms that matter** ([3rd-party API terms](https://support.curseforge.com/en/support/solutions/articles/9000207405-curse-forge-3rd-party-api-terms-and-conditions),
last modified 14 Aug 2024):

| Clause | What it says | What it means for us |
|---|---|---|
| §3.1(e) | You may not "save or cache any data obtained through the API or SDK" | A daily snapshot of download counts is caching. Not allowed without permission |
| §3.1 | You may not build anything that "competes, directly or indirectly, with CF" | A ranked addon list could be read as competing. Ask about it explicitly |
| §3.1(d) | You may not remove or obscure copyright notices | Keep the authors' names and logos as served |
| §2.3 | Above a quota Overwolf sets, it may require a written licence "which may contain payment requirements" | A free plan can become a paid one at Overwolf's discretion |
| §8 | Overwolf may end the terms for a single app without cause | Whatever we build on it can be switched off |
| §12.1 | Notices must be in writing | Get any permission by email, not on Discord |

The terms ask for no attribution, and they set out no process for requesting permission. The only
official contacts I found are the application form above, the CurseForge support ticket form, and
`cfforstudios@overwolf.com` (listed for studio integrations, so it may not be the right desk).
**Unverified:** which inbox handles third-party permission requests. Ask through the support ticket form
and request a written reply from the account's email address.

### Draft email (not sent)

```text
Subject: Permission request: cached CurseForge data on a non-commercial, open-source WoW site

Hello,

I run Everloot (https://everloot.app, source at https://github.com/Everloot/everloot), a free,
open-source (AGPL-3.0) database for WoW: Forever, built from players' own addon uploads. We also
publish an addon on CurseForge (project 1762765).

Our page at https://everloot.app/addons/popular ranks the addons that players actually run. Today
it only links to each addon's CurseForge page, because section 3.1(e) of the 3rd-party API terms
does not allow caching.

We would like written permission to do the following for addons listed on that page:

- show the CurseForge download count, the latest file version and its date, and a link to the
  addon's CurseForge page;
- fetch this through the API at most once a day, store only the latest values, and show the date
  they were read;
- credit CurseForge next to the data and link back for every addon;
- never host or mirror files, never show ads, and charge nothing.

That works out to a few hundred addons, with one request per addon or one search page per day.

Could you confirm whether this is allowed, whether it needs a separate API key or agreement, and
whether you would see it as competing with CurseForge under section 3.1? If any part of it isn't
allowed, we will keep linking only.

Thank you,
Carlos
Everloot · hello@everloot.app
```

## 2. CurseForge author features for the Everloot addon

- **Already in use.** `release.yml` uploads the tested zip of every `addon-v*` tag to project `1762765`
  using the Upload API, tagged for Forever `1.60.1` (game version 17053), as Alpha or Release according to the changelog
  ([`docs/RELEASING.md`](RELEASING.md), [`scripts/upload-curseforge.py`](../scripts/upload-curseforge.py),
  [Upload API](https://support.curseforge.com/support/solutions/articles/9000197321-curseforge-api)).
  Nightlies stay on GitHub. No change is needed.
- **Project page.** It takes a description, screenshots, a source link, an issues link and categories.
  Keep it consistent with the website (`docs/2026-10-24-planners-live-client-checklist.md` already says to
  inspect images before uploading them to CurseForge or Wago).
- **Stats.** The author console shows downloads for the project. **Unverified** at the time of writing
  (I didn't sign in): the exact breakdown, for example per day or per file. Downloads say nothing about who
  uploads data. Keep Everloot's own install count (the three-install rule) as the measure we publish.
- **Rewards.** CurseForge pays authors points that can be redeemed for cash. The terms guarantee no points,
  and CurseForge may change how they are earned at any time
  ([rewards terms](https://support.curseforge.com/support/solutions/articles/9000197898-rewards-program-terms-of-service);
  payouts through Tremendous or Payoneer according to the
  [CurseForge blog](https://blog.curseforge.com/introducing-tremendous-a-game-changing-payout-solution-for-curseforge-authors/)).
  Third-party sites quote rates, but the official pages publish none, so expect small amounts. Opting in
  means a payout account and tax details, which makes it a decision for the owner. Turning rewards on
  changes nothing in the addon.

## 3. Overwolf platform (ow-electron) for the Desktop App

**What it is.** ow-electron is Overwolf's fork of Electron. It adds `app.overwolf.packages`: `gep` (game
events), `overlay` (in-game windows and hotkeys), `recorder`, `utility` and `crn`
([API overview](https://dev.overwolf.com/ow-electron/reference/Overwolf-electron-APIs/packages/Overview/)).
Most of Overwolf's changes are closed source
([FAQ](https://dev.overwolf.com/ow-electron/getting-started/onboarding-resources/ow-electron-faq/)).

**Game events for WoW** ([WoW GEP page](https://dev.overwolf.com/ow-electron/live-game-data-gep/supported-games/world-of-warcraft)):
`location` (x, y, map id), `player_info` (level, XP, gold, silver, copper), `game_info.group_applicants`
and `gep_internal`. The examples use `gameId` 765. The `addons` feature, which listed loaded addons, was
removed on 2024-07-03. The page doesn't mention Classic, Classic Era or WoW: Forever. **Unverified, and
unlikely:** whether GEP detects the Forever client at all. Even if it did, the addon already records
everything GEP offers, and more.

**Overlay.** Windows-only in practice. The FAQ says only ad services run on macOS and Linux, though newer
dev-mode pages list the full package set without saying which platforms. That conflict is unresolved.

**Distribution, review and updates.**
- Overwolf's DevRel QA team reviews each app before it gets developer console access. You need your own
  code-signing certificate from the first release, or the gaming packages won't load. The app needs a
  visible window. Terms of Use and a Privacy Policy must be public, need no login, and must describe the
  data collected ([release your app](https://dev.overwolf.com/ow-electron/getting-started/release-your-app/)).
- **Since 1 November 2026, Overwolf approves only apps with Overwolf monetization** (Overwolf ads, Tebex
  subscriptions, or both; third-party monetization isn't allowed) (same page and the FAQ).
- On hosting outside the store, the official pages disagree. The FAQ says you can host the app anywhere,
  while other ow-electron pages say public distribution must go through the Overwolf Appstore. **Unverified.**
- The Overwolf docs describe no app auto-updater. The Desktop App already has its own update flow
  (`updateRestart` in `desktop/src/main/index.ts`).

**What moving `desktop/` would cost.**

| | Cost |
|---|---|
| Money and terms | Ads or a Tebex subscription would be required. That breaks "free, no ads" and the free-services rule, and adds the App Developer Terms to the obligations |
| Privacy | Ad SDKs collect data that `docs/DATA_POLICY.md` doesn't cover. It would need a new policy and a new consent screen |
| AGPL | We would ship AGPL code inside a closed-source runtime with closed packages it downloads. Whether the "Corresponding Source" can be met is **unverified**. It needs counsel before anyone tries |
| Work | A new runtime under our electron-builder fuses, signing, a QA review, store assets (55x55 icon, 258x198 tile, 1200x675 screenshots), and a review delay before every release |
| Size | **Unverified.** Overwolf packages download at runtime and check for updates every few hours |
| Gain | A WoW event feed we don't need, and an overlay that would mostly duplicate the addon's own frames |

**Verdict.** Don't do it before launch, and don't plan it for after. Look again only if a feature
needs an overlay that the addon can't draw in game, and if Overwolf drops the monetization rule for
open-source apps.

## 4. Other things the account offers

| Option | Value | Effort | Risk | Owner steps |
|---|---|---|---|---|
| Ask for written permission to cache CurseForge data (§1 email) | Download counts and latest versions on `/addons/popular` | Low: one email | Low. A refusal changes nothing (D8 stands) | Send the email through the support form, then file the reply in decisions |
| Apply for a third-party read key, only after permission | Needed to carry out a yes | Low: one form, then a small daily Worker job | Medium: §2.3 quota and licence, §8 termination | Apply with the description from the email. Store the key as a Worker secret |
| Finish the CurseForge project page | Players can find the addon and trust it | Low | Low | Description, screenshots, source and issues links, categories. Match the website copy |
| Join CurseForge author rewards | Small payouts. No change to the addon | Low | Low. Needs tax and payout details | Opt in from the author console if wanted |
| Ask about Forever as a CurseForge game version and category | The addon filed in the right place, and other Forever addons easier to find | Low | Low | Ask support whether version 17053 is listed for players and how Forever addons are filtered |
| Move the Desktop App to ow-electron | Overlay and WoW GEP events | High | High: monetization, AGPL, privacy | None. Not recommended |
| List the Desktop App in the Overwolf Appstore | Some extra reach | Medium | High: needs ow-electron and monetization | None. Not recommended |

Every option here leaves upload data quality untouched. That still comes from the addon and the intake rules.

## Sources

- CurseForge 3rd-party API terms: https://support.curseforge.com/en/support/solutions/articles/9000207405-curse-forge-3rd-party-api-terms-and-conditions
- How to apply for a CurseForge API key: https://support.curseforge.com/support/solutions/articles/9000208346-about-the-curseforge-api-and-how-to-apply-for-a-key
- CurseForge REST API docs: https://docs.curseforge.com/rest-api/
- CurseForge Upload API: https://support.curseforge.com/support/solutions/articles/9000197321-curseforge-api
- Rewards program terms: https://support.curseforge.com/support/solutions/articles/9000197898-rewards-program-terms-of-service
- Payouts (Tremendous): https://blog.curseforge.com/introducing-tremendous-a-game-changing-payout-solution-for-curseforge-authors/
- ow-electron WoW game events: https://dev.overwolf.com/ow-electron/live-game-data-gep/supported-games/world-of-warcraft
- ow-electron packages: https://dev.overwolf.com/ow-electron/reference/Overwolf-electron-APIs/packages/Overview/
- ow-electron FAQ: https://dev.overwolf.com/ow-electron/getting-started/onboarding-resources/ow-electron-faq/
- ow-electron release steps: https://dev.overwolf.com/ow-electron/getting-started/release-your-app/
- ow-electron store assets: https://dev.overwolf.com/ow-electron/getting-started/onboarding-resources/prepare-your-assets/
