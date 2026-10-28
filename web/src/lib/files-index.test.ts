import { expect, test } from "vitest";
import { filesIndex } from "./files-index";

test("the site's files index carries the committed build and every kind the files name, and no achievement text", () => {
  const index = filesIndex();
  expect(index.build).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  const kinds = new Set(index.facts.map((f) => f.kind));
  for (const kind of ["zone", "instance", "boss", "flight", "mount", "achievement", "talent"]) expect(kinds.has(kind as never)).toBe(true);
  const molten = index.facts.find((f) => f.kind === "instance" && f.name === "Molten Core");
  expect(molten?.url).toBe("https://everloot.app/database/instances/409-molten-core");
  expect(molten?.claim).toContain("the files list 11 encounters");
  // Every achievement fact is a count and a link, never the criteria's words.
  for (const f of index.facts.filter((f) => f.kind === "achievement")) expect(f.claim).toMatch(/^.+: an achievement, \d+ points(, \d+ criteria)?; the criteria text is on its page\.$/);
  expect(filesIndex()).toBe(index);
});
