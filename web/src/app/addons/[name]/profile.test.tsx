import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
const github = vi.hoisted(() => ({ addonGithub: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus },
}));
vi.mock("@/lib/addon-github", () => ({ addonGithub: github.addonGithub }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`308 ${to}`); },
  redirect: (to: string) => { throw new Error(`307 ${to}`); },
}));

import AddonProfilePage, { generateMetadata } from "./page";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";

let n = 0;
const seen = (installId: string, name: string, version?: string, loaded = true, title = name) => ({
  kind: "addon_seen", eventId: `${installId}:addon:${++n}`, installId, capturedAt: "2026-10-16T08:00:00.000Z", name, title, loaded,
  ...(version ? { version } : {}),
});
let version = 0;
const corpus = (records: unknown[]) => ({
  uploads: records.length, records, dataAsOf: new Date(Date.UTC(2026, 9, 17, 12, version++)).toISOString(),
});
const props = (name: string) => ({ params: Promise.resolve({ name }) });
const html = async (name: string) => renderToStaticMarkup(await AddonProfilePage(props(name)));
const three = (name: string, v?: string, title = name) => ["a", "b", "c"].map((id) => seen(id, name, v, true, title));

const okGithub = {
  status: "ok",
  data: {
    repo: "fitzforge/polestar", url: "https://github.com/fitzforge/polestar", license: "GPL-3.0", archived: false, openIssues: 4,
    release: { tag: "v0.2.4", name: null, date: "2026-10-14", url: "https://github.com/fitzforge/polestar/releases/tag/v0.2.4", notes: "Fixed arrows." },
    lastCommit: "2026-10-16", contributors: { count: 3, capped: false }, tree: [{ name: "Polestar", kind: "dir" }],
  },
};

beforeEach(() => {
  store.loadCorpus.mockReset();
  github.addonGithub.mockReset().mockResolvedValue(okGithub);
});

test("three installs show the counts, share and versions three agree on, newest version first, for an approved addon", async () => {
  store.loadCorpus.mockResolvedValue(corpus([
    ...three("Polestar", "9.9.0"),
    ...three("Polestar", "9.10.0"),
    seen("a", "Polestar", "9.99-mine"),
    seen("d", "Bagnon"),
  ]));
  const page = await html("Polestar");
  expect(page).toContain("Installs reporting");
  expect(page).toContain("75%");
  expect(page).toContain("3 of 4 loaded it");
  expect(page).toContain("2026-10-16");
  expect(page.indexOf("9.10.0")).toBeLessThan(page.indexOf("9.9.0"));
  expect(page).not.toContain("9.99-mine");
});

test("an addon three installs report but nobody approved has no page, no title and no source", async () => {
  store.loadCorpus.mockResolvedValue(corpus([...three("Questie", "9.9.0", "Questie Deluxe"), ...three("Bagnon")]));
  await expect(html("Questie")).rejects.toThrow("NOT_FOUND");
  await expect(html("questie")).rejects.toThrow("NOT_FOUND");
  await expect(html("Bagnon")).rejects.toThrow("NOT_FOUND");
  const meta = await generateMetadata(props("Questie"));
  expect(meta.title).toBe("Page not found");
  expect(meta.alternates).toBeUndefined();
  expect(github.addonGithub).not.toHaveBeenCalled();
});

test("a one- or two-install addon and a made-up name both 404, and nothing names the addon", async () => {
  store.loadCorpus.mockResolvedValue(corpus([
    ...three("Questie"),
    seen("a", "MyGuildTools", "1.0"), seen("b", "MyGuildTools", "1.0"),
  ]));
  await expect(html("MyGuildTools")).rejects.toThrow("NOT_FOUND");
  await expect(html("NeverReported")).rejects.toThrow("NOT_FOUND");
  expect((await generateMetadata(props("MyGuildTools"))).title).toBe("Page not found");
});

test("an unapproved name never reads the upload store, so a crawler guessing names costs nothing", async () => {
  await expect(html("Questie")).rejects.toThrow("NOT_FOUND");
  await generateMetadata(props("Questie"));
  expect(store.loadCorpus).not.toHaveBeenCalled();
});

test("uploads that forge an approved addon's title, spelling or version cannot change its page, title or source", async () => {
  store.loadCorpus.mockResolvedValue(corpus([
    ...three("Polestar", "6.6.6", "Polestar Gold: free gems at evil.example"),
    ...three("polestar", "6.6.6", "polestar (official)"),
    ...three("Polestar.Alternate", "6.6.6", "Polestar"),
  ]));
  const page = await html("Polestar");
  const meta = await generateMetadata(props("Polestar"));
  expect(meta.title).toBe("Polestar – WoW Forever Addon");
  expect(meta.alternates?.canonical).toBe("/addons/polestar");
  expect(String(meta.description)).not.toMatch(/evil|gems|official/);
  expect(page).not.toMatch(/evil\.example|free gems|\(official\)/);
  // The source is the owner's, and only the owner's.
  expect(github.addonGithub).toHaveBeenCalledTimes(1);
  expect(github.addonGithub).toHaveBeenCalledWith("fitzforge/polestar");
  expect(page).toContain('href="https://github.com/fitzforge/polestar/releases"');
  expect(page).toContain('href="https://www.curseforge.com/wow/addons/polestar-guides"');
  expect(page).not.toMatch(/href="https?:\/\/(?!(?:github\.com\/fitzforge\/polestar|www\.curseforge\.com\/wow\/addons\/polestar-guides|everloot\.app)\b)[^"]*"/);
  // A near-name is a different, unapproved addon.
  await expect(html("Polestar.Alternate")).rejects.toThrow("NOT_FOUND");
});

test("a registry-approved addon the curated map lacks is published with the registry's source and the owner's title", async () => {
  store.loadCorpus.mockResolvedValue(corpus(three("Olympus", "1.2.0", "Olympus (hacked title)")));
  const page = await html("Olympus");
  const meta = await generateMetadata(props("olympus"));
  expect(github.addonGithub).toHaveBeenCalledWith("dnl-gentile/olympus-addon");
  expect(page).toContain('href="https://github.com/dnl-gentile/olympus-addon/releases"');
  expect(page).toContain("Installs reporting");
  expect(page).not.toContain("hacked title");
  expect(meta.title).toBe("Olympus – WoW Forever Addon");
  expect(meta.alternates?.canonical).toBe("/addons/Olympus");
  expect(meta.robots).toBeUndefined();
});

test("a name matches without regard to case and answers 308 to the owner's spelling", async () => {
  store.loadCorpus.mockResolvedValue(corpus(three("Olympus")));
  await expect(html("olympus")).rejects.toThrow("308 /addons/Olympus");
  expect(await html("Olympus")).toContain("Installs reporting");
  await expect(html("POLESTAR")).rejects.toThrow("308 /addons/Polestar");
});

test("a malformed percent-encoded name is a 404, not an error", async () => {
  store.loadCorpus.mockResolvedValue(corpus(three("Polestar")));
  await expect(html("%E0%A4%A")).rejects.toThrow("NOT_FOUND");
  expect((await generateMetadata(props("%E0%A4%A"))).title).toBe("Page not found");
});

test("when storage is down, an approved page keeps its repository and no page is marked noindex; an unapproved one stays a 404", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  const curated = await html("Polestar");
  expect(curated).toContain(STORAGE_UNREACHABLE);
  expect(curated).toContain("GPL-3.0");
  expect(github.addonGithub).toHaveBeenCalledTimes(1);
  expect((await generateMetadata(props("Polestar"))).robots).toBeUndefined();
  await expect(html("Questie")).rejects.toThrow("NOT_FOUND");
  expect((await generateMetadata(props("Questie"))).title).toBe("Page not found");
});

test("a curated addon shows GitHub facts, author download links and plain links only", async () => {
  store.loadCorpus.mockResolvedValue(corpus(three("Polestar", "0.2.4")));
  const page = await html("Polestar");
  expect(github.addonGithub).toHaveBeenCalledWith("fitzforge/polestar");
  expect(page).toContain("GPL-3.0");
  expect(page).toContain("Fixed arrows.");
  expect(page).toContain('href="https://github.com/fitzforge/polestar/releases"');
  expect(page).toContain('href="https://www.curseforge.com/wow/addons/polestar-guides"');
  expect(page).toContain('href="/docs"');
  expect(page).toContain('href="/api/corpus/public"');
});

test("when GitHub cannot be reached the page still renders, says why, and keeps the download links", async () => {
  store.loadCorpus.mockResolvedValue(corpus(three("Polestar")));
  github.addonGithub.mockResolvedValue({ status: "unavailable", rateLimited: true });
  const limited = await html("Polestar");
  expect(limited).toContain("GitHub is limiting how often");
  expect(limited).toContain('href="https://github.com/fitzforge/polestar/releases"');
  github.addonGithub.mockResolvedValue({ status: "unavailable", rateLimited: false });
  const down = await html("Polestar");
  expect(down).toContain("GitHub did not answer");
  expect(down).toContain('href="https://github.com/fitzforge/polestar/releases"');
  github.addonGithub.mockResolvedValue({ status: "missing" });
  const missing = await html("Polestar");
  expect(missing).toContain("was not found on GitHub");
  expect(missing).not.toContain("Repository facts");
});

test("an approved addon below three installs still shows its repository, with the opt-in instead of numbers", async () => {
  store.loadCorpus.mockResolvedValue(corpus([seen("a", "Polestar")]));
  const page = await html("Polestar");
  expect(page).not.toContain("Installs reporting");
  expect(page).toContain("/everloot addons on");
  expect(page).toContain("GPL-3.0");
});

test("the canonical link uses the owner's spelling of the name and the page is indexable", async () => {
  store.loadCorpus.mockResolvedValue(corpus(three("Olympus")));
  const meta = await generateMetadata(props("olympus"));
  expect(meta.alternates?.canonical).toBe("/addons/Olympus");
  expect(meta.robots).toBeUndefined();
});

test("Polestar's usage profile names the dedicated guide page as its canonical", async () => {
  store.loadCorpus.mockResolvedValue(corpus(three("Polestar")));
  for (const name of ["Polestar", "POLESTAR"]) {
    expect((await generateMetadata(props(name))).alternates?.canonical).toBe("/addons/polestar");
  }
});

test("every external link carries noopener noreferrer nofollow", async () => {
  store.loadCorpus.mockResolvedValue(corpus(three("Polestar")));
  const page = await html("Polestar");
  const external = [...page.matchAll(/<a [^>]*>/g)].map((m) => m[0]).filter((tag) => /href="https?:/.test(tag));
  expect(external.length).toBeGreaterThan(3);
  for (const tag of external) expect(tag).toContain('rel="noopener noreferrer nofollow"');
});

test("copy has no paid-plan or ad wording", async () => {
  store.loadCorpus.mockResolvedValue(corpus(three("Olympus")));
  expect(await html("Olympus")).not.toMatch(/premium|subscription|\bpaid\b|sponsor|\bads?\b|pricing/i);
});
