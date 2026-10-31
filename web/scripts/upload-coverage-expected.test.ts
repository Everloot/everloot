import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import clientLayer from "../src/data/game-data/client-layer.json";
import { bucketProblems, checkCoverageUpload, committedBuild, liveFolderProblems, publishCoverage, snapshotProblems } from "./upload-coverage-expected";

// The committed build, read from the layer, so a new build's pull request changes no line here.
const { product, buildId, buildConfig, version } = clientLayer.build;
const build = { product, buildId, buildConfig };
const FOLDER = `${product}-${buildId}-${buildConfig.slice(0, 8)}`;
const AS_OF = "2026-10-22T18:00:00.000Z";
const expected = () => ({ version: 1, dataAsOf: AS_OF, zones: [{ zone: "1429", types: { quest: 4 }, fields: { quest: { title: 2, level: 2 } } }] });
const report = (over: Record<string, unknown> = {}) => ({ version: 1, dataAsOf: AS_OF, connected: true, clientConnected: true, rows: [], expected: expected(), plateau: null, ...over });
const check = (raw: unknown, rep: unknown = report(), folder = FOLDER) => checkCoverageUpload({ expected: raw, report: rep, folder, build });

test("the committed client layer is the current build, not the old 70450 one", () => {
  expect(committedBuild()).toMatchObject(build);
  expect(build.product).toBe("wowf");
  expect(build.buildId).toBeGreaterThan(70450);
});

test("a counts-only file from a connected report of the current build passes, and is sent as it parsed", () => {
  const ok = check(expected());
  expect(ok.problems).toEqual([]);
  expect(ok.zones).toBe(1);
  expect(JSON.parse(ok.body!)).toEqual(expected());
});

test("unknown keys, names and identifiers refuse the whole file", () => {
  const withName = { ...expected(), zones: [{ ...expected().zones[0], name: "Elwynn Forest" }] };
  const withIdField = { ...expected(), zones: [{ ...expected().zones[0], fields: { quest: { "783": 1 } } }] };
  for (const raw of [{ ...expected(), build: "1.60.1.70532" }, withName, withIdField, { ...expected(), zones: [{ ...expected().zones[0], zone: "Elwynn" }] }]) {
    const r = check(raw, report({ expected: raw }));
    expect(r.problems).toContain("the file is not a counts-only coverage-expected file");
    expect(r.body).toBeNull();
  }
});

test("dataAsOf must be a real timestamp, and the report's own; there is no age cutoff", () => {
  for (const dataAsOf of [null, undefined, "2026-13-40", "yesterday"]) {
    const raw = { ...expected(), dataAsOf };
    expect(check(raw, report({ expected: raw, dataAsOf })).body, String(dataAsOf)).toBeNull();
  }
  const old = { ...expected(), dataAsOf: "2026-01-01T00:00:00.000Z" };
  expect(check(old, report({ expected: old, dataAsOf: old.dataAsOf })).problems).toEqual([]);
  expect(check(old).problems).toContain("the file is not the expected counts of this report");
});

test("the report must be connected to uploads and a client snapshot, and hold exactly this file", () => {
  expect(check(expected(), report({ connected: false })).problems).toContain("the report was made without the uploads (connected is not true)");
  expect(check(expected(), report({ clientConnected: false })).problems).toContain("the report was made without a client snapshot (clientConnected is not true)");
  const other = { ...expected(), zones: [{ ...expected().zones[0], types: { quest: 5 } }] };
  expect(check(expected(), report({ expected: other })).problems).toContain("the file is not the expected counts of this report");
  expect(check(expected(), report({ dataAsOf: "2026-10-23T00:00:00.000Z" })).problems).toContain("the file's dataAsOf is not the report's");
  expect(check(expected(), { version: 2 }).body).toBeNull();
});

test("the live folder is the committed build's, or the same build uploaded again under -N", () => {
  expect(liveFolderProblems(FOLDER, build)).toEqual([]);
  expect(liveFolderProblems(`${FOLDER}-2`, build)).toEqual([]);
  for (const folder of ["wow_classic_beta-70450-84bea423", `${FOLDER}x`, `${FOLDER}-private`, `${FOLDER}-names`, "../x", ""]) {
    expect(liveFolderProblems(folder, build), folder).not.toEqual([]);
  }
  expect(check(expected(), report(), "wow_classic_beta-70450-84bea423").body).toBeNull();
});

test("the client snapshot must be the committed build's, by its manifest, name and hash", () => {
  const dir = mkdtempSync(join(tmpdir(), "everloot-coverage-"));
  const snap = (name: string, meta: Record<string, unknown>, body = "sqlite") => {
    const path = join(dir, name);
    writeFileSync(path, body);
    writeFileSync(`${path}.manifest.json`, JSON.stringify({ ...build, version, sha256: createHash("sha256").update(body).digest("hex"), ...meta }));
    return path;
  };
  expect(snapshotProblems(snap(`${FOLDER}.sqlite`, {}), build)).toEqual([]);
  expect(snapshotProblems(snap("wow_classic_beta-70450-84bea423.sqlite", { product: "wow_classic_beta", buildId: 70450, buildConfig: "84bea423aaaaaaaa" }), build)).toEqual([
    `the client snapshot is build wow_classic_beta-70450-84bea423, the committed client layer is ${FOLDER}`,
  ]);
  expect(snapshotProblems(snap(`${FOLDER}.sqlite`, { sha256: "0".repeat(64) }), build)).toEqual(["the client snapshot does not match its manifest's sha256"]);
  expect(snapshotProblems(join(dir, "missing.sqlite"), build)).toEqual(["the client snapshot has no manifest beside it"]);
});

test("the private bucket is required and must not be the public one", () => {
  const env = { ASSETS_S3_ENDPOINT: "https://r2.example", ASSETS_BUCKET: "pub", ASSETS_PRIVATE_BUCKET: "priv", ASSETS_ACCESS_KEY_ID: "k", ASSETS_SECRET_ACCESS_KEY: "s" };
  expect(bucketProblems(env)).toEqual([]);
  expect(bucketProblems({ ...env, ASSETS_PRIVATE_BUCKET: "pub" })).toEqual(["ASSETS_PRIVATE_BUCKET must be a different, private bucket"]);
  expect(bucketProblems({ ...env, ASSETS_PRIVATE_BUCKET: "" })[0]).toMatch(/Set ASSETS_PRIVATE_BUCKET/);
  expect(bucketProblems({})[0]).toMatch(/Set ASSETS_S3_ENDPOINT, ASSETS_BUCKET, ASSETS_PRIVATE_BUCKET, ASSETS_ACCESS_KEY_ID, ASSETS_SECRET_ACCESS_KEY/);
});

/** A bucket in memory: GET and PUT on one key. */
function bucket(initial: string | null, { corrupt = false } = {}) {
  let stored = initial;
  const calls: string[] = [];
  const fetch = async (_url: string, init: { method: string; body?: string } = { method: "GET" }) => {
    calls.push(init.method);
    if (init.method === "PUT") { stored = corrupt ? `${init.body}x` : init.body!; return new Response("", { status: 200 }); }
    return stored === null ? new Response("", { status: 404 }) : new Response(stored, { status: 200 });
  };
  return { fetch, calls, stored: () => stored };
}

test("a new file is written and read back byte for byte", async () => {
  const b = bucket(null);
  expect(await publishCoverage(b.fetch, "u", "{}\n", { replace: false })).toBe("written");
  expect(b.calls).toEqual(["GET", "PUT", "GET"]);
  expect(b.stored()).toBe("{}\n");
});

test("the same file already there is left alone; a different one is refused unless --replace", async () => {
  const same = bucket("{}\n");
  expect(await publishCoverage(same.fetch, "u", "{}\n", { replace: false })).toBe("unchanged");
  expect(same.calls).toEqual(["GET"]);
  const other = bucket("{\"old\":1}\n");
  await expect(publishCoverage(other.fetch, "u", "{}\n", { replace: false })).rejects.toThrow(/different coverage-expected.json is already there/);
  expect(other.calls).toEqual(["GET"]);
  expect(await publishCoverage(other.fetch, "u", "{}\n", { replace: true })).toBe("written");
  expect(other.stored()).toBe("{}\n");
});

test("a read-back that differs from what was sent fails", async () => {
  await expect(publishCoverage(bucket(null, { corrupt: true }).fetch, "u", "{}\n", { replace: false })).rejects.toThrow(/read back differs/);
});
