import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { instanceClears, type InstanceClears } from "@/lib/dungeon-clears";

vi.mock("next/link", () => ({ default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
const state = vi.hoisted(() => ({ clears: null as InstanceClears | null, calls: [] as number[] }));
vi.mock("@/lib/progression", () => ({ loadInstanceClears: async (id: number) => { state.calls.push(id); return state.clears; } }));

import ClearsPage, { generateMetadata } from "./[instance]/page";

const text = (html: string) => html.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");
const render = async (instance: string) => renderToStaticMarkup(await ClearsPage({ params: Promise.resolve({ instance }) }));
const k = (encounterId: number, last: string) => ({ instanceMapId: 389, encounterId, difficulty: 1, firstKillAt: "2026-11-10T00:00:00Z", lastKillAt: last, killCount: 1 });
const all = [2732, 2733, 2734, 2735];

beforeEach(() => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  vi.stubEnv("EVERLOOT_INSTANCE_CLEARS", "1");
  state.calls = [];
  state.clears = instanceClears(389, [
    { region: "us", slug: "mira-dawn", name: "Mira", surname: "Dawn", kills: all.map((id) => k(id, "2026-11-20T00:00:00Z")) },
    { region: "eu", slug: "tavi-reed", name: "Tavi", surname: "Reed", kills: all.map((id) => k(id, "2026-11-22T00:00:00Z")) },
  ]);
});
afterEach(() => vi.unstubAllEnvs());

test("recent clears list each character, newest first, linked to its armory page, with the first clear and last kill", async () => {
  const html = await render("389");
  expect(text(html)).toContain("Recent clears: Ragefire Chasm");
  expect(html).toContain('href="/database/instances/389-ragefire-chasm"');
  expect(html.indexOf('href="/armory/eu/tavi-reed"')).toBeGreaterThan(-1);
  expect(html.indexOf('href="/armory/eu/tavi-reed"')).toBeLessThan(html.indexOf('href="/armory/us/mira-dawn"'));
  const row = html.split("<tr").find((r) => r.includes("/armory/us/mira-dawn")) ?? "";
  expect([...row.matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/g)].map((m) => text(m[1]!).replace(/^\||\|$/g, ""))).toEqual(["Mira Dawn", "US", "2026-11-10", "2026-11-20"]);
  expect(state.calls).toEqual([389]);
});

test("the page stays out of search engines like every armory page", async () => {
  expect((await generateMetadata({ params: Promise.resolve({ instance: "389" }) })).robots).toEqual({ index: false, follow: false });
});

test("no clear yet says so; storage down says so", async () => {
  state.clears = instanceClears(389, []);
  expect(text(await render("389"))).toContain("No linked character has killed every boss here yet");
  state.clears = null;
  expect(await render("389")).toContain('role="status"');
});

test("a 404 with either switch off, for an id that is not a number, or an instance the files list no boss for; nothing is read", async () => {
  vi.stubEnv("EVERLOOT_INSTANCE_CLEARS", "");
  await expect(render("389")).rejects.toThrow("NEXT_NOT_FOUND");
  vi.stubEnv("EVERLOOT_INSTANCE_CLEARS", "1");
  vi.stubEnv("EVERLOOT_ARMORY", "");
  await expect(render("389")).rejects.toThrow("NEXT_NOT_FOUND");
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  for (const bad of ["389-ragefire-chasm", "0", "abc", "999999"]) await expect(render(bad)).rejects.toThrow("NEXT_NOT_FOUND");
  expect(state.calls).toEqual([]);
});
