import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { writeBuildVersion } from "./build-version.mjs";

test("the generated stamp follows a new build without shipping the rest of the layer", () => {
  const dir = mkdtempSync(join(tmpdir(), "build-version-"));
  try {
    const source = join(dir, "layer.json"), output = join(dir, "version.json");
    writeFileSync(source, JSON.stringify({ build: { product: "wowf", version: "1.60.1.99999" }, items: [1, 2, 3] }));
    writeBuildVersion(source, output);
    execFileSync(process.execPath, [fileURLToPath(new URL("./build-version.mjs", import.meta.url)), source, output]);
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual({ product: "wowf", version: "1.60.1.99999" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
