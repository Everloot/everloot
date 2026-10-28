import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { CURRENT_VERSION, GAME_VERSIONS, shortBuild, versionLabel } from "./game-version";

const dir = join(__dirname, "..", "data", "game-data");
const read = (file: string) => JSON.parse(readFileSync(join(dir, file), "utf8"));

describe("game versions", () => {
  test("Live, PTR and Beta, in that order; only Beta is available today", () => {
    expect(GAME_VERSIONS.map((v) => [v.id, v.available])).toEqual([["live", false], ["ptr", false], ["beta", true]]);
    expect(CURRENT_VERSION.id).toBe("beta");
  });

  test("an unavailable version has no build and says why", () => {
    for (const v of GAME_VERSIONS.filter((x) => !x.available)) {
      expect(v.build).toBeNull();
      expect(v.product).toBeNull();
      expect(v.note).toBeTruthy();
    }
    expect(GAME_VERSIONS[0].note).toContain("2026-11-04");
  });

  test("the label is the short build", () => {
    expect(shortBuild("1.60.1.70450")).toBe("1.60.1");
    expect(versionLabel()).toBe(`Build ${shortBuild(CURRENT_VERSION.build!)}`);
  });

  // A build bump regenerates the layers; one left behind would show the old build under the new label.
  test("every committed game-data layer names the current build", () => {
    const want = { product: CURRENT_VERSION.product, version: CURRENT_VERSION.build };
    const stamps: [string, { product?: string; version?: string }][] = [];
    for (const file of ["client-layer.json", "client-digests.json", "spell-values.json"]) stamps.push([file, read(file).build]);
    stamps.push(["map.json", read("map.json").source]);
    for (const file of readdirSync(join(dir, "talents")).filter((f) => f.endsWith(".json"))) stamps.push([`talents/${file}`, read(`talents/${file}`).build]);
    expect(stamps.length).toBeGreaterThan(10);
    for (const [file, stamp] of stamps) expect({ file, product: stamp.product, version: stamp.version }, file).toEqual({ file, ...want });
    const raid = readdirSync(dir).filter((f) => /^raid-.*\.json$/.test(f));
    expect(raid).toEqual([`raid-${CURRENT_VERSION.build}.json`]);
    expect(read(raid[0]).build).toBe(CURRENT_VERSION.build);
  });
});
