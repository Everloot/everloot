import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import build from "@/data/game-data/build-version.json";
import { wrongDataUrl } from "./report-wrong-data";

test("the link opens the Wrong data issue form with the type, id and build in the title and the page in its link field", () => {
  const url = new URL(wrongDataUrl({ type: "NPC", id: 448, path: "/database/npcs/448", build: "1.60.1.71091" }));
  expect(`${url.origin}${url.pathname}`).toBe("https://github.com/Everloot/everloot/issues/new");
  expect(url.searchParams.get("template")).toBe("wrong-data.yml");
  expect(url.searchParams.get("title")).toBe("Wrong data: NPC 448 (build 1.60.1.71091)");
  expect(url.searchParams.get("link")).toBe("https://everloot.app/database/npcs/448");
  // Nothing else: the form asks the player the rest in their own words.
  expect([...url.searchParams.keys()].sort()).toEqual(["link", "template", "title"]);
});

test("without a build of its own the link names the build the site serves", () => {
  const url = new URL(wrongDataUrl({ type: "Mount", id: 6, path: "/database/mounts/6-brown-horse" }));
  expect(url.searchParams.get("title")).toBe(`Wrong data: Mount 6 (build ${build.version})`);
  expect(url.searchParams.get("link")).toBe("https://everloot.app/database/mounts/6-brown-horse");
});

test("the form the link fills still has a field with the id the link prefills", () => {
  const form = readFileSync(join(__dirname, "../../../.github/ISSUE_TEMPLATE/wrong-data.yml"), "utf8");
  expect(form).toMatch(/^\s+id: link$/m);
});
