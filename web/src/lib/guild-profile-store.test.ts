import { expect, test } from "vitest";
import { createCloudGuildProfileStore, createMemoryGuildProfileStore } from "./guild-profile-store";
import { EMPTY_GUILD_FIELDS, GuildFields } from "./guild-profile";

test("claims, stale owners, appointed members and audit in the fallback", async () => {
  const members = [{ user_id: "owner", character_slug: "mira-dawn", name: "Mira Dawn", rank: 0 }, { user_id: "editor", character_slug: "tavi-reed", name: "Tavi Reed", rank: 3 }];
  const store = createMemoryGuildProfileStore(() => members);
  expect(await store.write("claim", "editor", "us", "star-watch")).toBe(false);
  expect(await store.write("claim", "owner", "us", "star-watch")).toBe(true);
  expect(await store.write("appoint", "editor", "us", "star-watch", "editor")).toBe(false);
  expect(await store.write("appoint", "owner", "us", "star-watch", "stranger")).toBe(false);
  expect(await store.write("appoint", "owner", "us", "star-watch", "editor")).toBe(true);
  expect(await store.save("editor", "us", "star-watch", { ...EMPTY_GUILD_FIELDS, bio: "<b>Plain text</b>" })).toBe("saved");
  expect((await store.profile("us", "star-watch"))?.updated_by).toBe("editor");
  members[0].rank = 4;
  expect((await store.access("owner", "us", "star-watch")).stale).toBe(true);
  expect(await store.save("editor", "us", "star-watch", EMPTY_GUILD_FIELDS)).toBe("forbidden");
  members[1].rank = 0;
  expect(await store.write("claim", "editor", "us", "star-watch")).toBe(true);
  expect((await store.access("editor", "us", "star-watch")).editors).toEqual([]);
  expect(await store.write("release", "owner", "us", "star-watch")).toBe(false);
  expect(await store.write("release", "editor", "us", "star-watch")).toBe(true);
});
test("validation rejects long text, unsafe URLs and unknown classes", () => {
  for (const fields of [
    { ...EMPTY_GUILD_FIELDS, bio: "a".repeat(1001) },
    { ...EMPTY_GUILD_FIELDS, details: { ...EMPTY_GUILD_FIELDS.details, website: "javascript:alert(1)" } },
    { ...EMPTY_GUILD_FIELDS, details: { ...EMPTY_GUILD_FIELDS.details, discord: "http://example.org" } },
    { ...EMPTY_GUILD_FIELDS, recruiting: { on: true, lookingFor: "", classes: ["BARD"] } },
  ]) expect(GuildFields.safeParse(fields).success).toBe(false);
});
test("cloud directory reads only the displayed guilds and sends mutations through checked RPCs", async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const store = createCloudGuildProfileStore(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    calls.push({ path, init });
    return (path.startsWith("rpc/") ? true : [{ region: "eu", slug: "star-watch" }]) as T;
  });
  expect(await store.recruiting([{ region: "eu", slug: "star-watch" }])).toEqual(new Set(["eu/star-watch"]));
  expect(calls[0].path).toContain("slug=in.(star-watch)"); expect(calls[0].path).toContain("limit=1");
  await store.write("claim", "owner", "eu", "star-watch");
  expect(calls[1].path).toBe("rpc/claim_guild");
  expect(JSON.parse(calls[1].init!.body as string)).toEqual({ p_user_id: "owner", p_region: "eu", p_slug: "star-watch" });
});
test("fallback limits saves and removes a departed editor's access", async () => {
  const members = [{ user_id: "o", character_slug: "mira-dawn", name: "Mira Dawn", rank: 0 }, { user_id: "e", character_slug: "tavi-reed", name: "Tavi Reed", rank: 2 }];
  let time = 0;
  const store = createMemoryGuildProfileStore(() => members, () => time);
  await store.write("claim", "o", "us", "star-watch");
  await store.write("appoint", "o", "us", "star-watch", "e");
  for (let i = 0; i < 30; i++) expect(await store.save("e", "us", "star-watch", EMPTY_GUILD_FIELDS)).toBe("saved");
  expect(await store.save("e", "us", "star-watch", EMPTY_GUILD_FIELDS)).toBe("limited");
  time = 3600000;
  expect(await store.save("e", "us", "star-watch", EMPTY_GUILD_FIELDS)).toBe("saved");
  members.pop();
  expect(await store.save("e", "us", "star-watch", EMPTY_GUILD_FIELDS)).toBe("forbidden");
});
