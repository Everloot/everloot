import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
// Storage is down: the pages are built from the game files alone, which is where the level comes from.
vi.mock("@/lib/instances", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/instances")>()),
  loadSightings: async () => ({ unreachable: true }),
}));

import InstancesPage from "./page";
import InstancePage from "./[instance]/page";

const text = (html: string) => html.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");
/** The cells of the list row that links to `href`, in column order. */
const cells = (html: string, href: string) => {
  const row = html.split("<tr").find((r) => r.includes(`href="${href}"`)) ?? "";
  return [...row.matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/g)].map((m) => text(m[1]!).replace(/^\||\|$/g, ""));
};

test("the list has a Level column and starts with the lowest level; a range the files lack is a dash", async () => {
  const html = renderToStaticMarkup(await InstancesPage());
  const headers = [...html.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((m) => text(m[1]!).replace(/\|/g, ""));
  expect(headers).toEqual(expect.arrayContaining(["Name", "Type", "Level", "Entered from"]));
  const rows = [...html.matchAll(/href="\/database\/instances\/(\d+)-[a-z0-9-]*"/g)].map((m) => Number(m[1]));
  expect(rows[0]).toBe(389); // Ragefire Chasm, level 13 in the files
  expect(rows.indexOf(389)).toBeLessThan(rows.indexOf(409)); // Molten Core, level 60
  expect(rows.indexOf(409)).toBeLessThan(rows.indexOf(249)); // Onyxia's Lair: the files give no level, so it is last, with the others like it
  const col = headers.indexOf("Level");
  expect(cells(html, "/database/instances/389-ragefire-chasm")[col]).toBe("13");
  expect(cells(html, "/database/instances/409-molten-core")[col]).toBe("60");
  expect(cells(html, "/database/instances/249-onyxia-s-lair")[col]).toBe("–");
});

test("an instance's page lists its level in the facts, or a dash when the files give none", async () => {
  const facts = async (segment: string) => text(renderToStaticMarkup(await InstancePage({ params: Promise.resolve({ instance: segment }) })));
  expect(await facts("389-ragefire-chasm")).toMatch(/\|Level\|13\|/);
  expect(await facts("409-molten-core")).toMatch(/\|Level\|60\|/);
  expect(await facts("249-onyxia-s-lair")).toMatch(/\|Level\|–\|/);
});
