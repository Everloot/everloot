# @everloot/protocol

The contract between the Everloot addon, its uploaders, [everloot.app](https://everloot.app) and the
clients that read it: the record kinds the addon writes, the upload envelope, the parser the site runs,
the sharing categories, the upload limits, the licence and credit line, the JSON API's response shapes
and route catalogue, and the MCP server's tool table. One definition, used by the site, the knowledge
base, the Desktop App and the command-line uploader, the addon's contract tests and anyone building on the data.

## Status

Used by everloot.app. The package version lives in `package.json` and is the only place it is stated. It
carries a second number, `PROTOCOL_VERSION` in `src/version.ts`: the upload contract an uploader stamps
on every envelope. The two move separately; read them from those two files, not from this page. Not yet
published to npm; the parts of this repository install it from the folder. After editing it, `npm run build` here, then in each consumer delete
`node_modules/@everloot/protocol` and `npm install` (npm keeps the packed copy while the version is the same).

## Install

It is not on npm yet, so install it from a clone of the repository:

```sh
git clone https://github.com/Everloot/everloot.git
cd everloot/packages/protocol && npm ci && npm run build
cd /path/to/your-project && npm install /path/to/everloot/packages/protocol zod
```

`zod` is a peer dependency. The package resolves the copy your project installs. You can also skip the
package and read the JSON Schema files in `schema/`, which the site serves at `https://everloot.app/schema/`.

## How it connects

- **The addon writes** records into `SavedVariables/Everloot.lua`, one list per kind. Its contract
  tests validate those rows against `schema/records/<kind>.json`, because Lua cannot import this package.
- **Uploaders send** them to `POST /api/intake` inside the envelope in `schema/upload.json`, stamped
  with `protocol: PROTOCOL_VERSION`, inside `UPLOAD_LIMITS`.
- **The site validates** every record with `parseRecords` and `parseUpload`, the same functions this
  package exports, and tells named data from anonymous data with `sharingCategory`.
- **API clients read** `API_ROUTES` and the response schemas (`schema/api/*.json`) to know what each
  endpoint answers; the site's route tests parse real responses with the same schemas.
- **MCP clients read** `MCP_TOOLS` (`schema/mcp/<tool>.json`): every tool's input shape, with the
  output stated as one text block ending in the data's age for answers built on player data, after
  the `More:` line that links the answer's page.

```ts
import { parseUpload, PROTOCOL_VERSION, UPLOAD_LIMITS } from "@everloot/protocol";

const parsed = parseUpload({ addonVersion: "0.3.7", protocol: PROTOCOL_VERSION, records });
if (parsed.ok) console.log(parsed.upload.records.length, "records accepted");
```

```ts
import { API_ROUTES, MCP_TOOL_NAMES, corpusPublicResponse } from "@everloot/protocol";

const body = corpusPublicResponse.parse(await (await fetch("https://everloot.app/api/corpus/public?kinds=loot")).json());
console.log(body.total, "loot windows;", MCP_TOOL_NAMES.length, "MCP tools;", API_ROUTES.length, "endpoints");
```

## Versioning

Both numbers follow semver. A new record kind, field or tool is a minor release. Removing or renaming anything, making a
field required, or tightening a limit is a major release. The server accepts the current major and the
previous one. The generated `schema/` and `dist/` folders are committed; CI rebuilds them and fails on
any difference.

## Licence

[AGPL-3.0-only](LICENSE), like the rest of Everloot. The data players upload is published under
CC BY-SA 4.0; see [`docs/DATA_POLICY.md`](../../docs/DATA_POLICY.md).
