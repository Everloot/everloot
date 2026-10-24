/**
 * Publishes the counts-only `coverage-expected.json` that `npm run kb -- coverage-report` writes to the private
 * bucket's live build folder, where the site reads it (`loadCoverageExpected` in src/lib/coverage-compute.ts).
 * A maintainer runs it with their own credentials; nothing runs it for them. See docs/2026-10-24-coverage-publication.md.
 *
 *   npx tsx scripts/upload-coverage-expected.ts <coverage-expected.json> --report <coverage-report.json>
 *     --snapshot <kb/data/client/<build>.sqlite> --folder <live build folder> [--dry-run] [--replace]
 *
 * Before anything is sent: the file parses strictly (counts under known keys only) with a real dataAsOf; the report
 * it came from was connected to the uploads and a client snapshot and holds exactly this file; that snapshot, by its
 * manifest, name and hash, is the committed client layer's build; and --folder is that build's folder (or `-N`).
 * Then it reads what is there: the same bytes are left alone, different ones are refused unless --replace. After
 * the PUT it reads the file back and compares bytes. It prints counts and the folder only, never the counts' keys.
 *
 * Environment (never arguments, never committed): the asset upload's ASSETS_S3_ENDPOINT, ASSETS_BUCKET (only to
 * refuse it as the target), ASSETS_PRIVATE_BUCKET, ASSETS_ACCESS_KEY_ID, ASSETS_SECRET_ACCESS_KEY and the optional
 * ASSETS_REGION. --dry-run needs none of them and sends nothing.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { AwsClient } from "aws4fetch";
import { parseCoverageExpected } from "../../kb/src/coverage";

type Build = { product: string; buildId: number; buildConfig: string };

/** The build of the committed client layer, the one the site's game data is read from. */
export function committedBuild(): Build {
  const { product, buildId, buildConfig } = JSON.parse(readFileSync(new URL("../src/data/game-data/client-layer.json", import.meta.url), "utf8")).build;
  return { product, buildId, buildConfig };
}

const folderOf = (b: Build) => `${b.product}-${b.buildId}-${String(b.buildConfig).slice(0, 8)}`;

/** The live folder must be the build's own, or the same build uploaded again under `<folder>-N`. */
export function liveFolderProblems(folder: string, build: Build): string[] {
  const own = folderOf(build);
  return folder === own || new RegExp(`^${own}-\\d+$`).test(folder) ? [] : [`--folder is not a folder of build ${own}`];
}

/** The snapshot's manifest names the committed build, its file is named for it, and its bytes match the manifest's hash. */
export function snapshotProblems(snapshot: string, build: Build): string[] {
  if (!existsSync(`${snapshot}.manifest.json`)) return ["the client snapshot has no manifest beside it"];
  const m = JSON.parse(readFileSync(`${snapshot}.manifest.json`, "utf8"));
  const own = folderOf(build), theirs = folderOf(m);
  if (m.product !== build.product || m.buildId !== build.buildId || m.buildConfig !== build.buildConfig) return [`the client snapshot is build ${theirs}, the committed client layer is ${own}`];
  if (basename(snapshot) !== `${own}.sqlite`) return [`the client snapshot is not named ${own}.sqlite`];
  if (createHash("sha256").update(readFileSync(snapshot)).digest("hex") !== m.sha256) return ["the client snapshot does not match its manifest's sha256"];
  return [];
}

/** Checks the file against its report and the folder; `body` is what goes up, null when anything is wrong. */
export function checkCoverageUpload({ expected, report, folder, build }: { expected: unknown; report: any; folder: string; build: Build }) {
  const problems = liveFolderProblems(folder, build);
  const parsed = parseCoverageExpected(expected);
  if (!parsed) problems.push("the file is not a counts-only coverage-expected file");
  else if (typeof parsed.dataAsOf !== "string") problems.push("the file has no dataAsOf");
  if (report?.version !== 1) problems.push("the report is not a version 1 coverage report");
  if (report?.connected !== true) problems.push("the report was made without the uploads (connected is not true)");
  if (report?.clientConnected !== true) problems.push("the report was made without a client snapshot (clientConnected is not true)");
  if (!isDeepStrictEqual(report?.expected, expected)) problems.push("the file is not the expected counts of this report");
  if (parsed && report?.dataAsOf !== parsed.dataAsOf) problems.push("the file's dataAsOf is not the report's");
  return { problems, zones: parsed?.zones.length ?? 0, body: problems.length ? null : `${JSON.stringify(parsed, null, 2)}\n` };
}

const ENV = ["ASSETS_S3_ENDPOINT", "ASSETS_BUCKET", "ASSETS_PRIVATE_BUCKET", "ASSETS_ACCESS_KEY_ID", "ASSETS_SECRET_ACCESS_KEY"];
export function bucketProblems(env: Record<string, string | undefined>): string[] {
  const missing = ENV.filter((k) => !env[k]);
  if (missing.length) return [`Set ${missing.join(", ")} in the environment first.`];
  return env.ASSETS_PRIVATE_BUCKET === env.ASSETS_BUCKET ? ["ASSETS_PRIVATE_BUCKET must be a different, private bucket"] : [];
}

type Fetch = (url: string, init?: { method: string; headers?: Record<string, string>; body?: string }) => Promise<Response>;

/** Writes `body` at `url` unless the same bytes are there; refuses different bytes without `replace`; reads back after. */
export async function publishCoverage(fetch: Fetch, url: string, body: string, { replace }: { replace: boolean }): Promise<"written" | "unchanged"> {
  const read = async () => {
    const res = await fetch(url, { method: "GET" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`reading the current file failed (${res.status})`);
    return res.text();
  };
  const current = await read();
  if (current === body) return "unchanged";
  if (current !== null && !replace) throw new Error("a different coverage-expected.json is already there; pass --replace to overwrite it");
  const put = await fetch(url, { method: "PUT", headers: { "content-type": "application/json", "cache-control": "private, max-age=300" }, body });
  if (!put.ok) throw new Error(`the upload failed (${put.status})`);
  if ((await read()) !== body) throw new Error("the file read back differs from the one sent");
  return "written";
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { report: { type: "string" }, snapshot: { type: "string" }, folder: { type: "string" }, "dry-run": { type: "boolean" }, replace: { type: "boolean" } },
  });
  if (positionals.length !== 1 || !values.report || !values.snapshot || !values.folder) {
    throw new Error("usage: upload-coverage-expected.ts <coverage-expected.json> --report <coverage-report.json> --snapshot <snapshot.sqlite> --folder <live build folder> [--dry-run] [--replace]");
  }
  const build = committedBuild();
  const readJson = (path: string, what: string) => {
    try { return JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error(`${what} is not readable JSON`); }
  };
  const { problems, zones, body } = checkCoverageUpload({ expected: readJson(positionals[0]!, "the expected file"), report: readJson(values.report, "the report"), folder: values.folder, build });
  problems.push(...snapshotProblems(values.snapshot, build));
  if (problems.length || !body) throw new Error(`Nothing uploaded:\n${problems.join("\n")}`);
  console.log(`coverage-expected.json: ${zones} zones, ${body.length} bytes, build ${folderOf(build)} -> <private bucket>/${values.folder}/coverage-expected.json`);
  if (values["dry-run"]) return console.log("Dry run, nothing sent.");

  const env = bucketProblems(process.env);
  if (env.length) throw new Error(env.join("\n"));
  const client = new AwsClient({ accessKeyId: process.env.ASSETS_ACCESS_KEY_ID!, secretAccessKey: process.env.ASSETS_SECRET_ACCESS_KEY!, service: "s3", region: process.env.ASSETS_REGION || "auto" });
  const url = `${process.env.ASSETS_S3_ENDPOINT!.replace(/\/+$/, "")}/${process.env.ASSETS_PRIVATE_BUCKET}/${values.folder}/coverage-expected.json`;
  const result = await publishCoverage((u, init) => client.fetch(u, init), url, body, { replace: Boolean(values.replace) });
  console.log(result === "unchanged" ? "The same file is already there; nothing sent." : "Written and read back byte for byte.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
