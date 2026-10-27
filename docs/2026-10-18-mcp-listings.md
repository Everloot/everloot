# Listing the Everloot MCP server (2026-10-18)

Where the public MCP server (`https://everloot.app/mcp/public`) gets listed so assistants and their
users can find it, what each place needs, what is done in the repository, and what only the owner can
do. Facts below were read from each platform's documentation on 2026-10-18; links are inline. Re-read a
platform's page on the day you submit, these portals change.

## What every listing says

**Next submission, prepared only (wave 6, 2026-10-25; updated 2026-10-27):** the public catalogue becomes **32 tools** once
`EVERLOOT_GUILDS` is on (PR #427): `guild_search` ("Find a guild by the start of its name") and `guild_rankings`
("Guild ladder for one raid or dungeon") join the list, and `guild_board` gains the ladder side. `class_races`
("Races that can be a class, with their racial traits", protocol 1.20.0) is listed with or without the switch. With
the switch off the live endpoint serves 30, so submit only after the switch is on and `/api/tools/guild_search`
answers 200. Use the exact titles and descriptions from `packages/protocol/src/mcp.ts` (protocol 1.20.0), and
change the tool count in the long description below to 32, adding racial traits to its list. Wave 5 (`item_page`, `coverage` wording) is folded
into this one. ChatGPT 1.0.1 and Claude are In review with the older descriptions: this lane submits nothing.

Use the same words everywhere, so the listings match the site and each other.

| Field | Text |
|---|---|
| Name | `Everloot` (registry name `app.everloot/knowledge`) |
| One line (≤100, registry) | WoW: Forever lore and player-observed drops, vendors, quests, professions and talents, with sources. |
| One line (≤200, Claude) | Look up WoW: Forever lore and what players actually saw in play: drop rates, vendors, quests, professions, map pins and talents. Every answer carries its source and licence. |
| Short description (≤30, ChatGPT) | WoW: Forever data with sources |
| Description (≤2,000) | see [Long description](#long-description) |
| Categories | ChatGPT: Entertainment (game reference service). Other directories: Gaming or the closest game reference category. |
| Endpoint | `https://everloot.app/mcp/public` (streamable HTTP, no sign-in, 200 requests per hour per IP) |
| Authentication | None. Public data only; nothing acts on a user's account. |
| Documentation | `https://everloot.app/docs/mcp` |
| Privacy policy | `https://everloot.app/privacy` |
| Terms | `https://everloot.app/terms` |
| Support | `hello@everloot.app`, `https://everloot.app/contact` |
| Website | `https://everloot.app` |
| Source | `https://github.com/Everloot/everloot` (AGPL-3.0-only) |
| Icon | `web/public/icon-512.png` and `icon-64.png`, rendered from the site icon (`https://everloot.app/icon-512.png`) |
| Reads or writes | Reads only. Every tool carries `readOnlyHint: true` and a `title` (checked against the live endpoint on 2026-10-20: 28 tools, all annotated). |
| Data handling | Our own API. No personal health data, no sponsored content, no conversation data collected. |

### Long description

> Everloot answers questions about World of Warcraft: Forever from two sources it names on every
> answer: the Warcraft Wiki archive (CC BY-SA 4.0, with the article each fact came from) and what
> players reported through the Everloot addon. A player-reported fact (a drop rate, a vendor's price, a
> quest's rewards, where an NPC stands, which recipe turns yellow) is stated only once three separate
> installs reported it, and the answer says how many did and when the data was last updated. Nothing
> is scraped from other sites and no fact is guessed: when something is not recorded yet, the tool says
> so instead of making a number up.
>
> 28 read-only tools: search the lore archive, open one record, look up an item, NPC, object, quest or
> vendor, find what is near a spot on the map, follow relations (dropped by, sold by, reagent for),
> browse item categories, plan a profession, read recipe skill ranges, check auction history and market
> values, a gold ledger, a guild board, achievement, reputation, title and quest progress, Blizzard's
> latest posts and builds, and the addon ecosystem.
> Game-file facts are labelled "found in game files, unconfirmed" with their build. Data is CC BY-SA 4.0
> with a credit line in every answer; the code is open source. No account, no key, no sign-in wall.

### Test cases (for reviewers)

Prompts a reviewer can run against the public endpoint. Each names the tool it should trigger.

| # | Prompt | Tool | Expected |
|---|---|---|---|
| P1 | Who is Thrall? | `search_knowledge` or `get_by_name` | A lore summary with the Warcraft Wiki source URL and licence |
| P2 | What does item 19019 connect to? | `entity_relations` | Relations grouped by kind, each saying "observed" with an install count or "in game files" with a build; or "unrecorded" |
| P3 | What are the latest WoW: Forever builds and Blizzard posts? | `recent_changes` | Newest first, with links to the originals and excerpts only |
| P4 | Which Forever addons are most installed? | `ecosystem_projects` | A ranked board with GitHub facts and install counts from three or more installs |
| P5 | What is near Elwynn Forest at 40, 60? | `world_map_near` | Entrances (game files) and observed NPCs or vendors with distances, or a clear "none recorded" |
| N1 | Buy me a mount | none | The assistant explains the tools read data and cannot act in the game |
| N2 | What is the drop rate of item 999999999? | `item_page` | "Unrecorded, not zero", never an invented rate |
| N3 | Show me player names who looted Thunderfury | `item_page` | No names: install counts only |

## 1. Official MCP Registry (published)

The community registry at `registry.modelcontextprotocol.io` is what Smithery, PulseMCP and others
ingest from, so it comes first. Docs: [quickstart](https://modelcontextprotocol.io/registry/quickstart),
[remote servers](https://modelcontextprotocol.io/registry/remote-servers),
[authentication](https://modelcontextprotocol.io/registry/authentication). The registry is in preview and
may reset.

- **`server.json`** at the repository root describes the remote server: name `app.everloot/knowledge`,
  one `streamable-http` remote, version `0.8.0` (the MCP server's `SERVER_VERSION`; bump both together).
  `mcp-publisher validate` passes.
- **Namespace proof** is the HTTP method: `web/public/.well-known/mcp-registry-auth` holds the public
  key record (`v=MCPv1; k=ed25519; p=…`). The matching private key is on the maintainer machine only,
  outside the repository, never committed.
- **Publish**, after the file is live at `https://everloot.app/.well-known/mcp-registry-auth`:

  ```sh
  # KEY is the path of the private key on the maintainer machine, outside the repository
  mcp-publisher login http --domain everloot.app --private-key "$(openssl pkey -in "$KEY" -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"
  mcp-publisher publish
  curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=app.everloot"
  ```

  A new version is a new `version` in `server.json` and another `publish`; versions are immutable.

## 2. Claude connectors directory (owner, about 20 minutes)

Docs: [Submit a connector](https://claude.com/docs/connectors/building/submission). Anyone on a paid
Claude plan can submit at [claude.ai/directory/manage](https://claude.ai/directory/manage) → **Submit
new** → **MCP connector**. The submission is scanned automatically and listed as a Community connector
by default; some get a human review. Escalations: `mcp-review@anthropic.com`.

Portal steps and what to paste, in order:

1. **Connection**: `https://everloot.app/mcp/public`.
2. **Tools**: sync from the server. Nothing should be flagged (title and `readOnlyHint` on all 28).
3. **Listing**: name `Everloot` (≤100), the ≤200 one-liner, the long description, categories, documentation
   `https://everloot.app/docs/mcp`, privacy `https://everloot.app/privacy`, support `hello@everloot.app`,
   icon `icon-512.png`, slug `everloot` (permanent).
4. **Use cases**: looking up WoW: Forever lore and player-observed game data while planning a character,
   a route or a purchase; nothing to set up before connecting; reads data only.
5. **Company**: Everloot (R21 Media Group, LLC), `https://everloot.app`, contact Carlos.
6. **Authentication**: no authentication.
7. **Data handling**: our own API; no personal health data; no sponsored content.
8. **Test & launch**: "No account needed. Add the URL as a custom connector and run the prompts P1 to P5
   and N1 to N3 from the documentation" (paste the table above); confirm every tool was run.
9. **Compliance**: the seven acknowledgments.

Before submitting, add the endpoint to Claude as a custom connector and run each tool once; the portal
asks you to confirm that. Verified status is a later, separate review:
[connector verification](https://claude.com/docs/connectors/verification).

## 3. ChatGPT (owner; needs a verified organization and a demo video)

OpenAI takes apps as plugins through the [OpenAI Platform plugins page](https://platform.openai.com/plugins)
("Upload new or existing plugin", option **With MCP**). Read on 2026-10-18 from the Apps SDK submission
page. Submission requirements:

- A **verified organization** (individual or business verification in organization settings); the owner
  submits, or a member with "Apps Management Write".
- **Domain verification**: the portal shows a challenge token to host as plain text at a URL under
  `everloot.app`. Add it to `web/public/` in a pull request when the portal gives it.
- **Test cases**: five positive and three negative (the table above fits the required fields:
  description, prompt, tools triggered, expected behaviour), each run with the test account first.
- A **demo recording URL** a reviewer can open.
- Listing fields with limits: display name ≤30 (`Everloot`), short description ≤30, long description
  ≤4,000, developer name ≤80, category, logo, website, support, privacy policy and terms URLs (all four
  required for MCP review).
- The server already answers the two tools OpenAI's [connector contract](https://developers.openai.com/api/docs/mcp)
  calls by name, `search` (results with `id`, `title`, `url`) and `fetch` (`id`, `title`, `text`, `url`,
  `metadata`), as structured content with the same JSON in the text block, so ChatGPT's connectors, deep
  research and company knowledge work against it without a special build. The 25 other tools stay listed
  beside them for clients that read the full tool list.
- One MCP server per plugin; ours is `https://everloot.app/mcp/public`, connection type "no
  authentication" (it is a public server, so that is the right value).

## 4. Grok Bot marketplace and Grok custom connectors

**Rechecked 2026-10-18:** there is a public [Grok Bot plugin submission form](https://x.ai/bot/marketplace/submit-a-plugin).
It accepts an MCP server URL or public GitHub repository for marketplace review. Select **Grok Bot**;
the form also offers Cursor and labels the Grok marketplace destination **coming soon**.

Prepare the owner's name and work email, organization name and lowercase handle, website, square SVG
or PNG logo URL with a background plate, a brief description, and testing instructions. Use
`https://everloot.app/mcp/public` as the server URL. The form requires confirmation that the plugin
was tested locally and in-app, and submission accepts the linked Publisher Terms. A successful HTTP
handshake alone does not satisfy that in-app test. The form is prepared; it has not yet been submitted.

Separately, Grok users can already add a remote MCP server at `grok.com/connectors` → New Connector →
Custom → the URL ([official connector instructions](https://docs.x.ai/grok/connectors)). This direct
connection is separate from marketplace approval.

The live endpoint returned HTTP 200 for `initialize` and `tools/list` during this check: 28 tools,
all marked read-only, including `search` and `fetch`. The count was re-read on 2026-10-20, when the
endpoint answered 28 tools, every one with a title and `readOnlyHint: true`, and a live
`search_knowledge` call returned a sourced answer. The registry entry stays at version `0.8.0`: the
server version did not move with the count. In-app connection and tool execution subsequently succeeded on all three platforms. The official registry entry is now active: [`app.everloot/knowledge`](https://registry.modelcontextprotocol.io/v0.1/servers?search=app.everloot), version `0.8.0`, published 2026-10-19 at 06:08 UTC.

### Re-sync before any resubmission (checked 2026-10-20)

A directory keeps the copy of the tool schemas it synced at submission time. Those copies close their
objects (`additionalProperties: false`), so a copy taken before the answers gained a `url` field will
reject a live answer that carries one. Diff the live `tools/list` against the copy each directory
holds, right before resubmitting, and re-sync the tools so the copy is current.

What the live endpoint serves was checked against the published contract on 2026-10-20, and it agrees:

| Check | Result |
|---|---|
| Live `inputSchema` vs `schema/mcp/<tool>.json` | 28 of 28 identical |
| Live `outputSchema` vs `schema/mcp/<tool>.json` | 28 of 28 identical |
| Live `title` vs the published title | 28 of 28 identical |
| Live answers vs the published output schema | every answer that could be exercised validated |
| `url` declared in the output schema | 22 tools declare it, and the answers that carry it declare it too |

Two deltas are expected and harmless, so a diff does not have to be explained: the live schemas name
the draft-07 dialect and the published files name 2020-12, and the live annotations carry `title` and
`destructiveHint` that the published descriptor does not list. The published copy cannot go stale on
its own: the release checks build the package and fail if the emitted files differ from what is
committed (`git diff --exit-code -- dist schema`).

Sync from production only. A preview deployment of a merged branch does not serve the MCP endpoint at
all: `everloot-web-git-<branch>-r21digital.vercel.app/mcp/public` answers 404, because a preview has
none of the production environment. That is the other way a resubmission ends up behaving differently
in review than locally, and here it fails loudly instead of quietly serving an old schema.

## 5. Community directories (owner, a web form each)

They mostly ingest from the official registry, so publish there first and check these a week later.

| Directory | How | Status |
|---|---|---|
| [Smithery](https://smithery.ai/new) | Web form or `smithery mcp publish`; remote servers need the public HTTPS endpoint | Check after the registry publish; submit by hand if it did not appear |
| [Glama](https://glama.ai/mcp) | "Add server" form for remote servers (listed as Connectors); claiming needs `/.well-known/glama.json` with an account-bound token, added in a pull request when the account exists | Owner creates the account; then the token file |
| [PulseMCP](https://www.pulsemcp.com) | Ingests the registry | Check after the publish |
| [mcpservers.org](https://mcpservers.org/submit) | Free form | Owner |
| [mcp.so](https://mcp.so) | Site form; reports of a paid tier, unverified | Optional |

## Credibility signals we already have (say them in every listing)

- Open source (AGPL-3.0-only) with public issues and a changelog.
- Every tool read-only and annotated; no account, no key, no OAuth: nothing to leak.
- Sources and licence on every answer; the three-install rule published at `/methodology`.
- Published OpenAPI, JSON Schema for every tool, and the `@everloot/protocol` package.
- `security.txt`, privacy and terms pages on the site.

## Submission progress

No listing text mentions numbers of users, uploads or installs; the data is sparse before launch and the
listing should not promise what the corpus does not hold.

Execution on 2026-10-18, using the maintainer's existing accounts:

- Official MCP Registry: published `app.everloot/knowledge` version `0.8.0`; the registry API reports active.
- Claude, ChatGPT and Grok: custom connections created and real tool calls completed successfully.
- Claude directory: listing draft prepared; all-tool verification and final submission still pending.
- ChatGPT directory: business publisher verified, Everloot project and plugin draft created, portable package accepted. Domain verification and final submission still pending.
- Grok Bot marketplace: form prepared; final submission still pending.

The portable OpenAI package is in [`integrations/openai/`](../integrations/openai/). The reviewer demo is a recording of the actual ChatGPT connector test conversation at `/review/everloot-chatgpt-demo.mp4`. A connected custom server and a public marketplace approval are separate states. This document does not claim approval before a platform reports it.
