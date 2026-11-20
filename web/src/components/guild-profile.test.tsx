import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { armoryGuild } from "@/lib/armory.fixture";
import { EMPTY_GUILD_FIELDS, type GuildAccess } from "@/lib/guild-profile";
import { createMemoryGuildProfileStore } from "@/lib/guild-profile-store";
import { GuildEditForm } from "@/app/armory/[region]/guilds/[slug]/edit/form";
import { CrestImages } from "./guild-crest";
import { crestImage } from "@kb/armory/crest";

const holder = vi.hoisted(() => ({ store: null as ReturnType<typeof createMemoryGuildProfileStore> | null, user: "owner" as string | null }));
vi.mock("@/lib/supabase/server", () => ({ authQuery: vi.fn(), getUser: async () => holder.user ? { id: holder.user } : null }));
vi.mock("@/lib/guild-profile-store", async (original) => ({ ...await original<typeof import("@/lib/guild-profile-store")>(), guildProfileStore: () => holder.store }));
const base: GuildAccess = { owner: false, editor: false, eligible: false, stale: false, members: [], editors: [] };
const form = (access: Partial<GuildAccess>) => renderToStaticMarkup(<GuildEditForm fields={EMPTY_GUILD_FIELDS} access={{ ...base, ...access }} action={async () => {}} />);
test("claim, owner, editor, ineligible and stale edit states", () => {
  expect(form({})).toContain("Only a linked Guild Master");
  expect(form({ eligible: true })).toContain("Claim this guild");
  const owner = form({ owner: true, eligible: true, members: [{ user_id: "e", character_slug: "tavi-reed", name: "Tavi Reed", rank: 3 }] });
  expect(owner).toContain("Save guild"); expect(owner).toContain("Appoint editor"); expect(owner).toContain("Release claim");
  const editor = form({ editor: true }); expect(editor).toContain("Save guild"); expect(editor).not.toContain("Release claim");
  const stale = form({ stale: true }); expect(stale).toContain("no longer linked at rank 0"); expect(stale).not.toContain("Save guild");
  expect(owner).toContain('maxLength="1000"'); expect(owner).toContain('maxLength="200"');
});
test("profile badge, escaped text, links and signed-in edit link", async () => {
  holder.store = createMemoryGuildProfileStore(() => [{ user_id: "owner", character_slug: "mira-dawn", name: "Mira Dawn", rank: 0 }]);
  const g = armoryGuild();
  await holder.store.write("claim", "owner", g.region, g.slug);
  await holder.store.save("owner", g.region, g.slug, { ...EMPTY_GUILD_FIELDS, bio: "<script>unsafe()</script>", recruiting: { on: true, lookingFor: "Healers", classes: ["PRIEST"] } });
  const { default: GuildProfile } = await import("./guild-profile");
  const html = renderToStaticMarkup(await GuildProfile({ guild: g }));
  expect(html).toContain("Recruiting"); expect(html).toContain("Healers"); expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>");
  expect(html).toContain("Claim or edit this guild");
  holder.user = null;
  expect(renderToStaticMarkup(await GuildProfile({ guild: g }))).not.toContain("Claim or edit this guild");
});
test("crest layers and safe media selection", () => {
  const color = { rgba: { r: 10, g: 20, b: 30 } };
  const html = renderToStaticMarkup(<CrestImages crest={{ emblem: { id: 1, color }, border: { id: 2, color }, background: { color } }} emblem="https://render.worldofwarcraft.com/emblem.png" border="https://render.worldofwarcraft.com/border.png" />);
  expect(html).toContain("In-game guild crest"); expect(html).toContain("feFlood"); expect(html).toContain("rgb(10, 20, 30)");
  expect(crestImage({ assets: [{ key: "image", value: "https://evil.example/image.png" }] })).toBeNull();
  expect(crestImage({ assets: [{ key: "image", value: "https://render.worldofwarcraft.com/image.png" }] })).toContain("image.png");
});
