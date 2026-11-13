import { expect, test } from "vitest";
import { readSubmissionForm } from "./form";

const req = (fields: Record<string, string>) => new Request("https://everloot.app/armory/submit/send", { method: "POST", body: new URLSearchParams(fields) });
test("an official armory link can be submitted without separate required name fields", async () => {
  expect(await readSubmissionForm(req({ armoryUrl: "https://worldofwarcraft.blizzard.com/en-us/forever/us/armory/character/ember-vale" }))).toMatchObject({ ok: true, region: "us", slug: "ember-vale", name: "Ember", surname: "Vale" });
  expect(await readSubmissionForm(req({ region: "eu", name: "Ember", surname: "Vale" }))).toMatchObject({ ok: true, slug: "ember-vale" });
});
test("untrusted hosts, invalid routes, credentials and malformed names are refused", async () => {
  for (const armoryUrl of ["https://evil.test/forever/us/armory/character/ember-vale", "https://worldofwarcraft.blizzard.com.evil.test/forever/us/armory/character/ember-vale", "http://worldofwarcraft.blizzard.com/forever/us/armory/character/ember-vale", "https://user@worldofwarcraft.blizzard.com/forever/us/armory/character/ember-vale", "https://worldofwarcraft.blizzard.com/forever/us/armory/character/ember", "https://worldofwarcraft.blizzard.com/forever/us/armory/character/%ZZ-vale"]) {
    expect(await readSubmissionForm(req({ armoryUrl }))).toMatchObject({ ok: false });
  }
});
