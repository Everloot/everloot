import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { characterProgression, progressionCatalogue } from "@kb/progression";
import { dungeonsAndRaids } from "@/lib/dungeon-clears";

vi.mock("next/link", () => ({ default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> }));
import DungeonsAndRaids from "./DungeonsAndRaids";

const catalogue = progressionCatalogue(null);
const text = (html: string) => html.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");
const kill = (instanceMapId: number, encounterId: number, first: string, last: string, killCount: number) =>
  ({ instanceMapId, encounterId, difficulty: 1, firstKillAt: first, lastKillAt: last, killCount });
// Ragefire Chasm (389) cleared; Molten Core (409) with two bosses down.
const kills = [
  kill(389, 2732, "2026-11-10T20:00:00Z", "2026-11-20T20:00:00Z", 3), kill(389, 2733, "2026-11-11T20:00:00Z", "2026-11-20T21:00:00Z", 2),
  kill(389, 2734, "2026-11-14T20:00:00Z", "2026-11-20T22:00:00Z", 2), kill(389, 2735, "2026-11-13T20:00:00Z", "2026-11-21T01:00:00Z", 1),
  kill(409, 663, "2026-11-22T20:00:00Z", "2026-11-22T20:00:00Z", 1), kill(409, 664, "2026-11-22T21:00:00Z", "2026-11-22T21:00:00Z", 1),
];
const render = (history: typeof kills | null, links: Record<number, string> = {}) =>
  renderToStaticMarkup(<DungeonsAndRaids data={dungeonsAndRaids(characterProgression(catalogue, history), history, links)} href="#progress" />);

test("each instance with a kill lists its bosses, cleared or not, with kill counts and dates; dungeons before raids", () => {
  const html = render(kills, { 389: "/database/instances/389-ragefire-chasm" });
  const t = text(html);
  expect(html).toContain('aria-labelledby="dungeons-raids"');
  expect(t).toContain("|Dungeons &amp; raids|");
  expect(html).toContain('href="#progress"');
  expect(html).toContain('href="/database/instances/389-ragefire-chasm"');
  expect(t.indexOf("Ragefire Chasm")).toBeLessThan(t.indexOf("Molten Core"));
  const rfc = html.split('data-dungeon-instance="389"')[1]!.split("data-dungeon-instance")[0]!;
  expect(text(rfc)).toContain("|Cleared|");
  expect(text(rfc)).toContain("First cleared |2026-11-14| UTC");
  expect(text(rfc)).toMatch(/Oggleflint\|3 kills · first 2026-11-10 · last 2026-11-20/);
  const mc = html.split('data-dungeon-instance="409"')[1]!;
  expect(text(mc)).toMatch(/\|2 \/ 11 bosses\|/);
  expect(text(mc)).toMatch(/Ragnaros\|Not killed/);
  expect(text(mc)).not.toContain("First cleared");
  // Only instances with a kill: nothing else from the files' list.
  expect(t).not.toContain("Wailing Caverns");
});

test("no synced history says so instead of showing zeros; a synced history with no kills says none is recorded", () => {
  const none = text(render(null));
  expect(none).toContain("No boss kills are synced for this character");
  expect(none).not.toMatch(/0\/\d+ tracked/);
  expect(text(render([]))).toContain("No boss kill is recorded");
});

test("the section says where kills come from and that lockouts are not part of it", () => {
  const t = text(render(kills));
  expect(t).toContain("Everloot Desktop App");
  expect(t).toMatch(/lockouts/i);
});
