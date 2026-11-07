import { expect, test } from "vitest";
import { cacheVersions, isTemplateFile, templateVersion, tree } from "./cache-versions.mjs";

const line = (blob: string, path: string) => `100644 blob ${blob}\t${path}`;
const listing = (...lines: string[]) => lines.join("\n");
const gitWith = (answers: Record<string, string>) => (args: string[]) => {
  const key = args.join(" ");
  const answer = Object.entries(answers).find(([prefix]) => key.startsWith(prefix))?.[1];
  if (answer === undefined) throw new Error(`unexpected git ${key}`);
  return answer;
};

test("the template version covers the rendering source and leaves out the API, the game data and tests", () => {
  for (const path of ["web/src/app/page.tsx", "web/src/components/card.tsx", "web/src/lib/items.ts", "web/next.config.js"]) expect(isTemplateFile(path), path).toBe(true);
  // The addon map belongs to the addon version, and the data folder to the data version.
  for (const path of ["web/src/app/api/items/route.ts", "web/src/data/game-data/items.json", "web/src/data/addon-repos.ts", "web/src/test/setup.ts", "web/src/lib/items.test.ts", "web/src/lib/items.spec.tsx"]) expect(isTemplateFile(path), path).toBe(false);
});

test("a page or shared component change changes the template version; an API, game-data or test-only change does not", () => {
  const source = ["web/src/app/page.tsx", "web/src/app/api/items/route.ts", "web/src/data/game-data/items.json", "web/src/data/addon-repos.ts", "web/src/test/setup.ts", "web/src/lib/items.test.ts"];
  const version = (blobs: Record<string, string>) => templateVersion(gitWith({
    "ls-tree": listing(...source.map((path) => line(blobs[path] ?? "aaa", path))),
  }));
  const base = version({});
  expect(version({ "web/src/app/api/items/route.ts": "bbb" })).toBe(base);
  expect(version({ "web/src/data/game-data/items.json": "bbb" })).toBe(base);
  expect(version({ "web/src/data/addon-repos.ts": "bbb" })).toBe(base);
  expect(version({ "web/src/test/setup.ts": "bbb" })).toBe(base);
  expect(version({ "web/src/lib/items.test.ts": "bbb" })).toBe(base);
  expect(version({ "web/src/app/page.tsx": "bbb" })).not.toBe(base);
});

test("a checkout with no readable HEAD or no source fails the deploy instead of stamping a version", () => {
  expect(() => tree("web/src/data/game-data", gitWith({}))).toThrow(/cannot read HEAD:web\/src\/data\/game-data/);
  expect(() => templateVersion(gitWith({ "ls-tree": "" }))).toThrow(/cannot read the committed rendering source/);
});

test("every version is read from the committed tree; a missing knowledge release fails closed", () => {
  const git = gitWith({
    "ls-tree": listing(line("tpl", "web/src/app/page.tsx")),
    "rev-parse HEAD:web/src/data/game-data": "data1",
    "rev-parse HEAD:kb": "kb1",
    "rev-parse HEAD:web/public": "public1",
    "rev-parse HEAD:web/src/data/addon-repos.ts": "addons1",
  });
  expect(cacheVersions({ gitRead: git, knowledgeRelease: "release1" })).toEqual({
    template: templateVersion(git),
    data: "data1",
    knowledge: "kb1-release1",
    addon: "public1-addons1",
  });
  expect(() => cacheVersions({ gitRead: git })).toThrow(/KNOWLEDGE_RELEASE_SHA256/);
});
