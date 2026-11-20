import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { armoryGuild } from "@/lib/armory.fixture";
import { createMemoryGuildProfileStore } from "@/lib/guild-profile-store";
import { EMPTY_GUILD_FIELDS } from "@/lib/guild-profile";

const holder = vi.hoisted(() => ({ user: "owner" as string | null, rank: 0, hidden: false, store: null as ReturnType<typeof createMemoryGuildProfileStore> | null }));
vi.mock("@/lib/supabase/server", () => ({ authQuery: vi.fn(), getUser: async () => holder.user ? { id: holder.user, name: "Player" } : null }));
vi.mock("@/lib/armory-store", () => ({ armoryStore: () => ({ guild: async () => armoryGuild({ region: "us", slug: "star-watch", name: "Star Watch" }) }) }));
vi.mock("@/lib/player-store", () => ({ playerStore: () => ({ hiddenGuilds: async () => new Set(holder.hidden ? ["us:star watch"] : []) }), guildHideKey: (_r: string, g: string) => `us:${g.toLowerCase()}` }));
vi.mock("@/lib/guild-profile-store", async (original) => ({ ...await original<typeof import("@/lib/guild-profile-store")>(), guildProfileStore: () => holder.store }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (path: string) => { throw new Error(`REDIRECT ${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const props = { params: Promise.resolve({ region: "us", slug: "star-watch" }), searchParams: Promise.resolve({}) };
beforeEach(() => {
  vi.stubEnv("EVERLOOT_ARMORY", "1"); holder.user = "owner"; holder.rank = 0; holder.hidden = false;
  holder.store = createMemoryGuildProfileStore(() => [{ user_id: "owner", character_slug: "mira-dawn", name: "Mira Dawn", rank: holder.rank }]);
});
test("edit page is noindex and explains signed-out and unlinked states", async () => {
  const { default: Page, metadata } = await import("./page");
  expect(metadata.robots).toEqual({ index: false, follow: false });
  holder.user = null;
  expect(renderToStaticMarkup(await Page(props))).toContain("Sign in to claim or edit");
  holder.user = "outsider";
  const html = renderToStaticMarkup(await Page(props));
  expect(html).toContain("Only a linked Guild Master"); expect(html).toContain("Banners come from");
});
test("owner form appears after claim; rank change pauses editing", async () => {
  const { default: Page } = await import("./page");
  expect(renderToStaticMarkup(await Page(props))).toContain("Claim this guild");
  await holder.store!.write("claim", "owner", "us", "star-watch");
  expect(renderToStaticMarkup(await Page(props))).toContain("Save guild");
  holder.rank = 1;
  expect(renderToStaticMarkup(await Page(props))).toContain("no longer linked at rank 0");
  expect(renderToStaticMarkup(await Page(props))).not.toContain("Save guild");
});
test("server action derives the user from the session, validates, saves and rejects a stale owner", async () => {
  const { changeGuild } = await import("./actions");
  const claim = new FormData(); claim.set("action", "claim");
  await expect(changeGuild("us", "star-watch", claim)).rejects.toThrow("result=saved");
  const form = new FormData();
  for (const [k, v] of Object.entries({ action: "save", user_id: "outsider", bio: "Our guild", raidDays: "Tuesday", discord: "https://discord.gg/example", website: "https://example.org", lookingFor: "Healers", recruiting: "on", classes: "PRIEST" })) form.set(k, v);
  await expect(changeGuild("us", "star-watch", form)).rejects.toThrow("result=saved");
  expect((await holder.store!.profile("us", "star-watch"))?.updated_by).toBe("owner");
  form.set("website", "javascript:alert(1)");
  await expect(changeGuild("us", "star-watch", form)).rejects.toThrow("result=invalid");
  form.set("website", "https://example.org"); holder.rank = 2;
  await expect(changeGuild("us", "star-watch", form)).rejects.toThrow("result=forbidden");
  expect(await holder.store!.save("outsider", "us", "star-watch", EMPTY_GUILD_FIELDS)).toBe("forbidden");
});
