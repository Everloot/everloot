import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { addonReleaseFor, fetchReleases, fileSize, newestDesktopRelease, servedFile } from "./everloot-releases";

const DL = "https://github.com/Everloot/everloot/releases/download";
const asset = (tag: string, name: string, size = 100, digest: string | null = `sha256:${"a".repeat(64)}`) => ({
  name, size, digest, browser_download_url: `${DL}/${tag}/${name}`,
});
const release = (tag: string, assets: unknown[], extra: Record<string, unknown> = {}) => ({
  tag_name: tag, html_url: `https://github.com/Everloot/everloot/releases/tag/${tag}`, published_at: "2026-10-19T15:22:44Z", draft: false, prerelease: false, assets, ...extra,
});

const list = [
  release("nightly-20261019.4", [asset("nightly-20261019.4", "Everloot-0.3.4-nightly.20261019.4.zip")], { prerelease: true }),
  release("desktop-v0.2.0", [asset("desktop-v0.2.0", "Everloot-DesktopApp-0.2.0-win-x64-setup.exe")], { draft: true }),
  release("desktop-v0.10.0", [], { prerelease: true }),
  release("desktop-v0.1.0", [
    asset("desktop-v0.1.0", "Everloot-DesktopApp-0.1.0-win-x64-setup.exe", 113304866),
    asset("desktop-v0.1.0", "Everloot-DesktopApp-0.1.0-mac-arm64.dmg", 130617780, null),
    { name: "elsewhere.exe", size: 1, digest: null, browser_download_url: "https://example.com/elsewhere.exe" },
    asset("desktop-v0.1.0", "SHA256SUMS", 443),
  ]),
  release("desktop-v0.0.9", [asset("desktop-v0.0.9", "Everloot-DesktopApp-0.0.9-win-x64-setup.exe")]),
  release("addon-v0.3.3", [asset("addon-v0.3.3", "Everloot-0.3.3.zip", 164889), asset("addon-v0.3.3", "SHA256SUMS", 85)], { published_at: "2026-10-18T00:05:47Z" }),
  release("addon-v0.3.2", [asset("addon-v0.3.2", "Everloot-0.3.2.zip")]),
];

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("the newest published desktop release wins; drafts, pre-releases, nightlies and addon tags are skipped", () => {
  expect(newestDesktopRelease(list)).toEqual({
    tag: "desktop-v0.1.0",
    version: "0.1.0",
    date: "2026-10-19",
    url: "https://github.com/Everloot/everloot/releases/tag/desktop-v0.1.0",
    sums: `${DL}/desktop-v0.1.0/SHA256SUMS`,
    files: [
      { name: "Everloot-DesktopApp-0.1.0-win-x64-setup.exe", url: `${DL}/desktop-v0.1.0/Everloot-DesktopApp-0.1.0-win-x64-setup.exe`, size: 113304866, sha256: "a".repeat(64) },
      { name: "Everloot-DesktopApp-0.1.0-mac-arm64.dmg", url: `${DL}/desktop-v0.1.0/Everloot-DesktopApp-0.1.0-mac-arm64.dmg`, size: 130617780, sha256: null },
    ],
  });
});

test("the addon release is the one matching the served version, not the newest", () => {
  const found = addonReleaseFor(list, "0.3.3");
  expect(found?.date).toBe("2026-10-18");
  expect(found?.sums).toBe(`${DL}/addon-v0.3.3/SHA256SUMS`);
  expect(addonReleaseFor(list, "0.9.9")).toBeNull();
});

test("the exact served addon Alpha has release notes and checksums without promoting desktop previews", () => {
  const alpha = release("addon-v0.3.11", [asset("addon-v0.3.11", "SHA256SUMS")], { prerelease: true });
  expect(addonReleaseFor([alpha], "0.3.11")?.tag).toBe("addon-v0.3.11");
  expect(addonReleaseFor([{ ...alpha, draft: true }], "0.3.11")).toBeNull();
  expect(newestDesktopRelease([release("desktop-v9.0.0", [], { prerelease: true })])).toBeNull();
});

test("no list, no releases", () => {
  expect(newestDesktopRelease(null)).toBeNull();
  expect(addonReleaseFor(null, "0.3.3")).toBeNull();
  expect(newestDesktopRelease([{ tag_name: 7 }, null])).toBeNull();
});

test("the list is read once an hour, with GITHUB_TOKEN when it is set", async () => {
  vi.stubEnv("GITHUB_TOKEN", "t0ken");
  const fetch = vi.fn(() => Promise.resolve(Response.json(list)));
  vi.stubGlobal("fetch", fetch);
  expect(await fetchReleases()).toHaveLength(list.length);
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit & { next?: { revalidate?: number } }];
  expect(url).toBe("https://api.github.com/repos/Everloot/everloot/releases?per_page=100");
  expect(init.next?.revalidate).toBe(3600);
  expect(init.headers).toMatchObject({ Authorization: "Bearer t0ken" });
});

test("a GitHub error, an outage or an odd answer is null, never a throw", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("limited", { status: 403 }))));
  expect(await fetchReleases()).toBeNull();
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
  expect(await fetchReleases()).toBeNull();
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json({ message: "Not Found" }))));
  expect(await fetchReleases()).toBeNull();
});

test("a served file's size and SHA-256 come from its bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "everloot-served-"));
  writeFileSync(join(root, "a.zip"), "abc");
  expect(servedFile("/a.zip", root)).toEqual({ size: 3, sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" });
  expect(servedFile("/missing.zip", root)).toBeNull();
});

test("sizes read as KB or MB", () => {
  expect(fileSize(164889)).toBe("161 KB");
  expect(fileSize(113304866)).toBe("108 MB");
  expect(fileSize(10)).toBe("1 KB");
});
