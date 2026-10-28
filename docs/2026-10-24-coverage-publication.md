# Publishing the coverage expected counts — 2026-10-24

`/database/coverage` reads its denominator from `<live build folder>/coverage-expected.json` in the private
bucket (`loadCoverageExpected` in `web/src/lib/coverage-compute.ts`). Until now nothing put it there; this is the
step 6 upload in [LAUNCH_DAY.md](LAUNCH_DAY.md). `web/scripts/upload-coverage-expected.ts` does it, and only it.

## Before it sends anything

- The file parses with `parseCoverageExpected` (counts under known zone, type and field keys; a name, an id or an
  unknown key refuses the whole file), and its `dataAsOf` is a real timestamp. There is no age limit: the counts
  are as old as the corpus the report read.
- The report it came from (`coverage-report.json`, same folder) has `connected` and `clientConnected` true, holds
  exactly this file as `expected`, and has the same `dataAsOf`.
- The client snapshot's manifest names the committed client layer's build (`web/src/data/game-data/client-layer.json`),
  the snapshot is named for it, and its sha256 matches the manifest.
- `--folder` is that build's folder (`<product>-<buildId>-<buildConfig[0..8]>`) or the same build uploaded again
  under `-N`. A file or folder from another build, such as the old 70450 one, is refused.

The report does not record which snapshot it read; the snapshot check proves the snapshot handed to this script is
the current build's, not that it was the one passed to `coverage-report --client`. Pass the same file to both.

## Running it

From `web/`, with the asset upload's environment (see the header of `scripts/upload-game-assets.mjs`):
`ASSETS_S3_ENDPOINT`, `ASSETS_BUCKET`, `ASSETS_PRIVATE_BUCKET`, `ASSETS_ACCESS_KEY_ID`, `ASSETS_SECRET_ACCESS_KEY`,
and optionally `ASSETS_REGION`. The private bucket must differ from the public one.

```
npx tsx scripts/upload-coverage-expected.ts <report folder>/coverage-expected.json \
  --report <report folder>/coverage-report.json \
  --snapshot <client folder>/wow_classic_beta-70532-ad1802f4.sqlite \
  --folder <live build folder> --dry-run
```

`--dry-run` checks everything above and needs no keys. Without it, the script reads the current file first: the
same bytes are left alone, different bytes are refused unless `--replace`. After the PUT it reads the file back
and compares bytes. It prints the zone count, the size and the folder, never zone ids or counts.

`<live build folder>` is the last path part of `NEXT_PUBLIC_GAME_ASSETS_URL` in production. Check it before the
real run; it must be the current build's folder.
