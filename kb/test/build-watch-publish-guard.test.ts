import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { generatedFiles } from "../src/build-watch/site-data.js";

// The build watch's publish step refuses any changed file outside its allow-list. A generator that writes a file
// the list does not name would stop every later build's data pull request, so each generated file must match it.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflow = readFileSync(join(root, ".github/workflows/build-watch.yml"), "utf8");
const allowed = new RegExp(/allowed='([^']+)'/.exec(workflow)![1]!);

it("every file the generators write is on the publish step's allow-list", () => {
  const files = generatedFiles(root);
  expect(files.length).toBeGreaterThan(10);
  expect(files.filter((f) => !allowed.test(f))).toEqual([]);
});
