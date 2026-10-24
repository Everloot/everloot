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
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
}));

import AddonProfilePage, { generateMetadata } from "./page";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";

let n = 0;
const seen = (installId: string, name: string, version?: string, loaded = true) => ({
  kind: "addon_seen", eventId: `${installId}:addon:${++n}`, installId, capturedAt: "2026-10-16T08:00:00.000Z", name, title: name, loaded,
  ...(version ? { version } : {}),
});
let version = 0;
const corpus = (records: unknown[]) => ({
  uploads: records.length, records, dataAsOf: new Date(Date.UTC(2026, 9, 17, 12, version++)).toISOString(),
});
const props = (name: string) => ({ params: Promise.resolve({ name }) });
const html = async (name: string) => renderToStaticMarkup(await AddonProfilePage(props(name)));
const three = (name: string, v?: string) => ["a", "b", "c"].map((id) => seen(id, name, v));

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
  github.addonGithub.mockReset();
});

test("three installs show the counts, share and versions three agree on, newest version first", async () => {
  store.loadCorpus.mockResolvedValue(corpus([
    ...three("Questie", "9.9.0"),
    ...three("Questie", "9.10.0"),
    seen("a", "Questie", "9.99-mine"),
    seen("d", "Bagnon"),
  ]));
  const page = await html("Questie");
  expect(page).toContain("Installs reporting");
  expect(page).toContain("75%");
  expect(page).toContain("3 of 4 loaded it");
  expect(page).toContain("2026-10-16");
  expect(page.indexOf("9.10.0")).toBeLessThan(page.indexOf("9.9.0"));
  expect(page).not.toContain("9.99-mine");
});

test("a one- or two-install addon and a made-up name both 404, and nothing names the addon", async () => {
  store.loadCorpus.mockResolvedValue(corpus([
    ...three("Questie"),
    seen("a", "MyGuildTools", "1.0"), seen("b", "MyGuildTools", "1.0"),
  ]));
  await expect(html("MyGuildTools")).rejects.toThrow("NOT_FOUND");
  await expect(html("NeverReported")).rejects.toThrow("NOT_FOUND");
  expect((await generateMetadata(props("MyGuildTools"))).title).toBe("Addon not found");
});

test("a name matches without regard to case and redirects to the canonical spelling", async () => {
  store.loadCorpus.mockResolvedValue(corpus(three("Questie")));
  await expect(html("questie")).rejects.toThrow("REDIRECT /addons/Questie");
  expect(await html("Questie")).toContain("Installs reporting");
  await expect(html("POLESTAR")).rejects.toThrow("REDIRECT /addons/Polestar");
});

test("a malformed percent-encoded name is a 404, not an error", async () => {
  store.loadCorpus.mockResolvedValue(corpus(three("Questie")));
  await expect(html("%E0%A4%A")).rejects.toThrow("NOT_FOUND");
  expect((await generateMetadata(props("%E0%A4%A"))).title).toBe("Addon not found");
});

test("when storage is down, no page 404s or is marked noindex: curated ones keep their repository, others show the outage", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  github.addonGithub.mockResolvedValue(okGithub);
  const curated = await html("Polestar");
  expect(curated).toContain(STORAGE_UNREACHABLE);
  expect(curated).toContain("GPL-3.0");
  const other = await html("Questie");
  expect(other).toContain(STORAGE_UNREACHABLE);
  expect(github.addonGithub).toHaveBeenCalledTimes(1);
  for (const name of ["Polestar", "Questie"]) expect((await generateMetadata(props(name))).robots).toBeUndefined();
});

test("a reported name that is not in the curated map says the repository is unknown and makes no GitHub call", async () => {
  store.loadCorpus.mockResolvedValue(corpus(three("Questie")));
  const page = await html("Questie");
  expect(page).toContain("does not know where this addon&#x27;s code is published");
  expect(github.addonGithub).not.toHaveBeenCalled();
});

test("a curated addon shows GitHub facts, author download links and plain links only", async () => {
  store.loadCorpus.mockResolvedValue(corpus(three("Polestar", "0.2.4")));
  github.addonGithub.mockResolvedValue(okGithub);
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
  github.addonGithub.mockResolvedValue({ status: "missing" });
  expect(await html("Polestar")).toContain("was not found on GitHub");
});

test("a curated addon below three installs still shows its repository, with the opt-in instead of numbers", async () => {
  store.loadCorpus.mockResolvedValue(corpus([seen("a", "Polestar")]));
  github.addonGithub.mockResolvedValue(okGithub);
  const page = await html("Polestar");
  expect(page).not.toContain("Installs reporting");
  expect(page).toContain("/everloot addons on");
  expect(page).toContain("GPL-3.0");
});

test("the canonical link uses the site's spelling of the name and the page is indexable", async () => {
  store.loadCorpus.mockResolvedValue(corpus(three("Questie")));
  const meta = await generateMetadata(props("questie"));
  expect(meta.alternates?.canonical).toBe("/addons/Questie");
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
  github.addonGithub.mockResolvedValue(okGithub);
  const page = await html("Polestar");
  const external = [...page.matchAll(/<a [^>]*>/g)].map((m) => m[0]).filter((tag) => /href="https?:/.test(tag));
  expect(external.length).toBeGreaterThan(3);
  for (const tag of external) expect(tag).toContain('rel="noopener noreferrer nofollow"');
});

test("copy has no paid-plan or ad wording", async () => {
  store.loadCorpus.mockResolvedValue(corpus(three("Questie")));
  expect(await html("Questie")).not.toMatch(/premium|subscription|\bpaid\b|sponsor|\bads?\b|pricing/i);
});
