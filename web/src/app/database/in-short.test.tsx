import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

/**
 * The In short block and the Copy for AI row on the vendor, zone and instance pages: each line is a fact the page
 * already shows, with its agreement and date; what nobody reported says so; the copy text starts with the name and
 * ends with the page's address.
 */

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus },
}));
vi.mock("@/lib/zone-lore", () => ({ zoneLore: () => null }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
  useRouter: () => ({ push: () => {} }),
}));
// The copy button keeps its text in a click handler, which static markup does not carry: shown here as a block instead.
vi.mock("@/components/ui/OpenData", () => ({
  default: ({ text, jsonHref }: { text: string; jsonHref?: string }) => <p><button type="button">Copy for AI</button>{jsonHref ? <a href={jsonHref}>Raw JSON</a> : null}<pre data-open-data>{text}</pre></p>,
}));

import VendorPage from "./vendors/[id]/page";
import ZonePage from "./zones/[zone]/page";
import InstancePage from "./instances/[instance]/page";

let n = 0;
const base = (installId: string) => ({ installId, eventId: `e${n++}`, capturedAt: "2026-10-10T00:00:00.000Z" });
const three = ["a", "b", "c"];
// Guard Thomas in Elwynn Forest (UiMap 1429), a vendor three installs agree on, standing where three installs saw him.
const guard = three.map((i) => ({ ...base(i), kind: "npc_sighting", positionKind: "npc", npcId: 1, name: "Guard Thomas", mapId: 1429, x: 40, y: 60 }));
const sells = three.map((i) => ({ ...base(i), kind: "vendor", vendorNpcId: 1, items: [{ itemId: 159, priceCopper: 25 }] }));
const serve = (records: unknown[]) => store.loadCorpus.mockResolvedValue({ uploads: 3, records, dataAsOf: "2026-10-10T00:00:00.000Z" });
const down = () => store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });

const html = async (el: Promise<ReactNode>) => renderToStaticMarkup(await el);
const openData = (out: string) => (/<pre data-open-data="true">([\s\S]*?)<\/pre>/.exec(out)?.[1] ?? "").split("\n");
const inShort = (out: string) => /<section aria-label="In short"[\s\S]*?<\/section>/.exec(out)?.[0] ?? "";

beforeEach(() => store.loadCorpus.mockReset());

test("a vendor page copies its In short lines, and links the NPC's card as Raw JSON once players reported the NPC", async () => {
  serve([...guard, ...sells]);
  const out = await html(VendorPage({ params: Promise.resolve({ id: "1" }) }));
  expect(inShort(out)).toContain("A vendor in WoW: Forever (NPC 1).");
  // The prices and the position are dated by the uploads they were read from, with the agreement beside them.
  expect(inShort(out)).toMatch(/Players reported 1 price and 1 map position \(last upload [^)]+\)\. Each has three installs agreeing\./);
  expect(inShort(out)).toContain("Players agree on the name.");
  expect(openData(out)).toEqual([
    "Guard Thomas (vendor 1)",
    "A vendor in WoW: Forever (NPC 1).",
    expect.stringMatching(/^Players reported 1 price and 1 map position \(last upload [^)]+\)\. Each has three installs agreeing\.$/),
    "Players agree on the name.",
    "Source: https://everloot.app/database/vendors/1",
  ]);
  expect(out).toContain('href="/api/tooltip/npc/1"');
});

test("a vendor nobody placed or named keeps Copy for AI and has no Raw JSON, since its NPC has no card", async () => {
  serve(sells);
  const out = await html(VendorPage({ params: Promise.resolve({ id: "1" }) }));
  expect(inShort(out)).toMatch(/Players reported 1 price \(last upload [^)]+\)\. Each has three installs agreeing\./);
  expect(openData(out)[0]).toBe("Vendor NPC 1 (vendor 1)");
  expect(openData(out).at(-1)).toBe("Source: https://everloot.app/database/vendors/1");
  expect(out).not.toContain("Raw JSON");
});

test("a vendor page with storage down says the figures are unrecorded, not that it has no prices", async () => {
  down();
  const out = await html(VendorPage({ params: Promise.resolve({ id: "1" }) }));
  expect(inShort(out)).toContain("Storage unreachable. These figures are unrecorded, not zero.");
  expect(inShort(out)).not.toContain("No player has reported");
  expect(inShort(out)).not.toContain("No prices");
});

test("a zone page sums up what three installs agree on, and the entrances the game files give it", async () => {
  serve([...guard, ...sells]);
  const out = await html(ZonePage({ params: Promise.resolve({ zone: "1429-elwynn-forest" }) }));
  expect(inShort(out)).toContain("A zone in Eastern Kingdoms; its name and outline are from the game files.");
  // The vendor count is dated by the uploads, not by a treasure or entrance date it does not have.
  expect(inShort(out)).toMatch(/Players reported 1 vendor \(last upload [^)]+\)\. Each has three installs agreeing\./);
  expect(inShort(out)).not.toContain("last seen");
  const text = openData(out);
  expect(text[0]).toBe("Elwynn Forest (zone 1429)");
  expect(text.at(-1)).toBe("Source: https://everloot.app/database/zones/1429-elwynn-forest");
  expect(out).not.toContain("Raw JSON");
});

test("a zone nobody reported anything in says so, and one with storage down says unrecorded, never zero", async () => {
  serve([]);
  const empty = await html(ZonePage({ params: Promise.resolve({ zone: "1411-durotar" }) }));
  expect(inShort(empty)).toContain("No player has reported it yet.");
  expect(inShort(empty)).toContain("A zone in Kalimdor; its name and outline are from the game files.");
  expect(openData(empty)[0]).toBe("Durotar (zone 1411)");
  // No entrance is "none recorded", with the reason, not a claim that nothing is entered from the zone.
  expect(inShort(empty)).toContain("No entrance recorded yet: the game files place none here and players have not confirmed one.");
  expect(empty).not.toContain("No dungeon or raid is entered from this zone");
  down();
  const unread = await html(ZonePage({ params: Promise.resolve({ zone: "1411-durotar" }) }));
  expect(inShort(unread)).toContain("Storage unreachable. These figures are unrecorded, not zero.");
  expect(inShort(unread)).not.toContain("No player has reported");
  // Unreadable reports are not the same as an empty list in the game files.
  expect(inShort(unread)).toContain("No entrance recorded yet in the game files; player reports could not be read just now.");
  expect(inShort(unread)).not.toContain("players have not confirmed one");
  expect(unread).not.toContain("No dungeon or raid is entered from this zone");
  // The entrances are the game files', so that line stays either way.
  expect(inShort(unread).match(/<li>/g)).toHaveLength(3);
});

test("an instance page sums up its type, level and the game files' list; with storage down the player line is unrecorded", async () => {
  down();
  const out = await html(InstancePage({ params: Promise.resolve({ instance: "409-molten-core" }) }));
  expect(inShort(out)).toContain("A raid, level 60 in the game files.");
  expect(inShort(out)).toContain("Storage unreachable. These figures are unrecorded, not zero.");
  expect(inShort(out)).toMatch(/The game files list 11 encounters and \d+ entrances?, unconfirmed until 3 installs report them\./);
  const text = openData(out);
  expect(text[0]).toBe("Molten Core (instance 409)");
  expect(text.at(-1)).toBe("Source: https://everloot.app/database/instances/409-molten-core");
  expect(out).not.toContain("Raw JSON");
});

test("an instance nobody reported says so; one with a boss three installs killed counts it with its date", async () => {
  serve([]);
  const empty = await html(InstancePage({ params: Promise.resolve({ instance: "389-ragefire-chasm" }) }));
  expect(inShort(empty)).toContain("A dungeon, level 13 in the game files.");
  expect(inShort(empty)).toContain("No player has reported it yet.");
  // SYNTHETIC: three installs killed one Ragefire Chasm encounter.
  serve(three.map((i) => ({ ...base(`install-${i}`), kind: "encounter", encounterId: 2732, name: "Oggleflint", instanceMapId: 389, success: true, npcIds: [11517], capturedAt: "2026-10-09T20:00:00Z" })));
  const killed = await html(InstancePage({ params: Promise.resolve({ instance: "389-ragefire-chasm" }) }));
  expect(inShort(killed)).toMatch(/Players reported 1 boss, last seen [^.]+\. Each has three installs agreeing\./);
});
