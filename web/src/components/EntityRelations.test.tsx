import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { Edge } from "../../../kb/src/edges";

vi.mock("next/link", () => ({
  default: ({ href, title, children }: { href: string; title?: string; children: ReactNode }) => <a href={href} title={title}>{children}</a>,
}));

import { EntityRelations, RelationTarget, SameIcon } from "./EntityRelations";

const client = (fromId: number, rel: Edge["rel"], toKind: Edge["toKind"], toId: number): Edge =>
  ({ fromKind: "item", fromId, rel, toKind, toId, evidence: "client", build: "1.60.1.70450", installs: null, firstSeen: null, lastSeen: null });
const observed: Edge[] = [
  { fromKind: "item", fromId: 2862, rel: "sold_by", toKind: "npc", toId: 1250, evidence: "observed", build: null, installs: 4, firstSeen: "2026-10-01T00:00:00.000Z", lastSeen: "2026-10-09T00:00:00.000Z" },
  { fromKind: "item", fromId: 2862, rel: "dropped_by", toKind: "npc", toId: 448, evidence: "observed", build: null, installs: 3, firstSeen: null, lastSeen: null },
];
const taught: Edge = { fromKind: "spell", fromId: 2660, rel: "in_skill_line", toKind: "skill", toId: 164, evidence: "client", build: "1.60.1.70450", installs: null, firstSeen: null, lastSeen: null };
const edges = [client(2862, "created_by", "spell", 2660), client(2862, "same_icon", "icon", 135249), client(2863, "same_icon", "icon", 135249), taught];

test("relations are grouped and linked where a page exists; observed rows count installs, game-file rows share one note with the build", () => {
  const html = renderToStaticMarkup(<EntityRelations kind="item" id={2862} observed={observed} client={edges} skip={["dropped_by"]} />);
  expect(html).toContain("Sold by");
  expect(html).toContain('href="/database/vendors/1250"');
  expect(html).toContain("4 installs, last seen 2026-10-09");
  expect(html).toContain("Created by");
  expect(html).toContain("spell 2660");
  // The profession that teaches the spell, by the client's name, beside it; not a mark on every game-file row.
  expect(html).toContain("· Blacksmithing");
  expect(html).not.toContain("unconfirmed, build");
  expect(html.match(/found in game files, unconfirmed/g)).toHaveLength(1);
  expect(html).toContain("read from build 1.60.1.70450");
  // An item sharing the icon has no name here, so it is counted, not listed as "item 2863".
  expect(html).toContain("shared with 1 item with no name yet");
  expect(html).not.toContain("item 2863");
  expect(html).toContain("Blizzard Entertainment");
  // The drop table above already shows drops in full.
  expect(html).not.toContain("Dropped by");
});

test("a spell's own relations name its profession and link to the profession pages", () => {
  const html = renderToStaticMarkup(<EntityRelations kind="spell" id={2660} observed={[]} client={edges} />);
  expect(html).toContain("Profession");
  expect(html).toContain('href="/tools/professions"');
  expect(html).toContain(">Blacksmithing<");
});

test("a relation target named from the name files: players first, a wiki title (its source in the hover card), a game-file name with the quiet marker", () => {
  const reward: Edge = { ...client(2862, "reward_from", "quest", 176), evidence: "observed", build: null, installs: 3 };
  const gameName = (kind: Edge["toKind"], id: number) =>
    kind === "quest" && id === 176 ? { name: "Wanted: Hogger", source: "wiki" as const } : kind === "spell" && id === 2660 ? { name: "Rough Sharpening Stone", source: "files" as const } : undefined;
  const quest = renderToStaticMarkup(<RelationTarget edge={reward} rel="reward_from" client={edges} gameName={gameName} />);
  // The link's hover card says where the title comes from; no plain title doubles it.
  expect(quest).toContain('<a href="/database/quests/176">Wanted: Hogger</a>');
  expect(quest).not.toContain("title=");
  expect(quest).toContain('class="sr-only"> (name from the warcraft wiki)');
  expect(quest).not.toContain("data-badge");
  // A title players agree on wins, with no tooltip of the wiki's.
  const agreed = renderToStaticMarkup(<RelationTarget edge={reward} rel="reward_from" client={edges} gameName={gameName} nameOf={() => "Wanted: Hogger!"} />);
  expect(agreed).toContain(">Wanted: Hogger!</a>");
  expect(agreed).not.toContain("Warcraft Wiki");
  const spell = renderToStaticMarkup(<RelationTarget edge={client(2862, "created_by", "spell", 2660)} rel="created_by" client={edges} gameName={gameName} />);
  expect(spell).toContain('title="From the game files, not yet confirmed by players">Rough Sharpening Stone</span>');
  expect(spell).toContain('data-badge="files"');
  expect(spell).toContain("· Blacksmithing");
  // Nothing in the files: "item set 1", as before.
  expect(renderToStaticMarkup(<RelationTarget edge={client(2862, "part_of_set", "item_set", 1)} rel="part_of_set" client={edges} gameName={gameName} />)).toBe("item set 1");
});

test("only observed relations: no game-file notice; none at all: says what is needed", () => {
  expect(renderToStaticMarkup(<EntityRelations kind="item" id={2862} observed={observed} client={[]} />)).not.toContain("Blizzard");
  expect(renderToStaticMarkup(<EntityRelations kind="item" id={1} observed={[]} client={[]} />)).toContain("No relations recorded");
});

test("items sharing an icon: named ones are links with their icon, nameless ones are one muted count, never a list of ids", () => {
  const icon = [10, 11, 12, 13, 14].map((id) => client(id, "same_icon", "icon", 135249));
  const names = new Map([[11, "Linen Cloak"], [12, "Wool Cloak"]]);
  const html = renderToStaticMarkup(<SameIcon edge={icon[0]} self={10} client={icon} itemName={(id) => names.get(id)} itemIcon={(id) => (id === 11 ? "https://x.test/cloak.jpg" : undefined)} />);
  expect(html).toContain("Icon file 135249, shared with ");
  expect(html).toContain('href="/database/items/11">Linen Cloak</a>');
  expect(html).toContain('href="/database/items/12">Wool Cloak</a>');
  expect(html).toContain("cloak.jpg");
  expect(html).toContain('<span class="text-muted">; 2 items with no name yet</span>');
  expect(html).not.toMatch(/item 1[34]/);
  // No names at all: only the count.
  const bare = renderToStaticMarkup(<SameIcon edge={icon[0]} self={10} client={icon} />);
  expect(bare).toContain("4 items with no name yet");
  expect(bare).not.toContain("<a ");
});
