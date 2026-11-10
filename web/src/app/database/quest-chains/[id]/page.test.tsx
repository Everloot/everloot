import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCompletion: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCompletion: store.loadCompletion },
}));
// The game files' quest lines: one no player has reported yet.
vi.mock("@/data/game-data/client-quest-lines", () => ({ get CLIENT_QUEST_LINES() { return { questLines: [{ id: 1, name: "The Missing Diplomat", questIds: [11, 10] }] }; } }));
vi.mock("@/data/game-data/client-titles", () => ({ get CLIENT_TITLES() { return { titles: [] }; } }));
vi.mock("@/data/game-data/client-factions", () => ({ get CLIENT_FACTIONS() { return { factions: [] }; } }));
vi.mock("@/data/game-data/client-achievements", () => ({ get CLIENT_ACHIEVEMENTS() { return { achievements: {} }; } }));
vi.mock("@/lib/names", () => ({ loadNames: async () => ({ items: new Map(), npcs: new Map(), quests: new Map() }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
}));
// The copy button keeps its text in a click handler, which static markup does not carry: shown here as a block instead.
vi.mock("@/components/ui/OpenData", () => ({
  default: ({ text, jsonHref }: { text: string; jsonHref?: string }) => <p><button type="button">Copy for AI</button>{jsonHref ? <a href={jsonHref}>Raw JSON</a> : null}<pre data-open-data>{text}</pre></p>,
}));

import ChainPage from "./page";
import { emptyCompletion, foldCompletion } from "../../../../../../kb/src/completion-rollup";

const at = "2026-11-08T00:00:00Z";
let seq = 0;
const chain = (installId: string, fields: Record<string, unknown>) => ({ kind: "quest_chain_catalog", installId, eventId: `e:${++seq}`, capturedAt: at, ...fields });
const from = (n: number, fields: Record<string, unknown>) => ["one", "two", "three"].slice(0, n).map((i) => chain(`reporter-${i}`, fields));
const serve = (records: Record<string, unknown>[]) =>
  store.loadCompletion.mockResolvedValue({ state: foldCompletion(emptyCompletion(), [{ records, grants: [] }]), dataAsOf: at });

const html = async (id: string) => renderToStaticMarkup(await ChainPage({ params: Promise.resolve({ id }) }));
const openData = (out: string) => (/<pre data-open-data="true">([\s\S]*?)<\/pre>/.exec(out)?.[1] ?? "").split("\n");

beforeEach(() => {
  seq = 0;
  serve([...from(3, { questLineId: 900, name: "The Defias", questIds: [7, 8, 9] }), ...from(3, { questLineId: 901, name: "Long Road", questIds: [1, 2], truncated: true })]);
});

test("a confirmed quest chain: In short with its quest count, three installs and when, and Copy for AI", async () => {
  const out = await html("900-the-defias");
  expect(out).toContain("In short");
  expect(out).toContain("A quest chain in WoW: Forever of 3 quests.");
  expect(out).toMatch(/Players reported it, three installs agreeing \(last upload [^)]+\)\./);
  expect(out).toContain("Players agree on the name.");
  expect(openData(out)).toEqual([
    "The Defias (quest chain 900)",
    "A quest chain in WoW: Forever of 3 quests.",
    expect.stringMatching(/^Players reported it, three installs agreeing \(last upload [^)]+\)\.$/),
    "Players agree on the name.",
    "Source: https://everloot.app/database/quest-chains/900-the-defias",
  ]);
  expect(out).not.toContain("Raw JSON");
});

test("a chain cut at its listed quests says it is longer", async () => {
  expect(await html("901-long-road")).toContain("A quest chain in WoW: Forever of more than 2 quests; the first 2 are listed.");
});

test("a chain only the game files list: unconfirmed, with how many installs have reported it, and the files' name", async () => {
  serve(from(2, { questLineId: 1, name: "The Missing Diplomat", questIds: [11, 10] }));
  const out = await html("1-the-missing-diplomat");
  expect(out).toMatch(/Found in game files, unconfirmed: 2 of 3 installs have reported it \(last upload [^)]+\)\./);
  expect(out).toContain("The name and the quests are shown from the game files; players have not reported them yet.");
  expect(out).not.toContain("Players agree on the name.");
  const text = openData(out);
  expect(text[0]).toBe("The Missing Diplomat (quest chain 1)");
  expect(text.at(-1)).toBe("Source: https://everloot.app/database/quest-chains/1-the-missing-diplomat");
});

test("with the player rollup unreadable, a files-only chain says reports could not be read, never zero installs", async () => {
  store.loadCompletion.mockResolvedValue({ state: null, dataAsOf: null, unreachable: true });
  const out = await html("1-the-missing-diplomat");
  expect(out).toContain("Found in game files, unconfirmed; player reports could not be read just now.");
  expect(out).not.toContain("0 of 3");
});
