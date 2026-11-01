import { expect, test, vi } from "vitest";
import { checkForUpdates, compareVersions, downloadFor, fetchReleases, newestDesktopRelease, releaseNotes, updateFrom } from "../src/main/updates";
import { allowedExternal } from "../src/main/external";
import { PROVIDER_PRESETS } from "../src/shared/providers";

test("versions compare by number, and a dev build is older than any release", () => {
  expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
  expect(compareVersions("1.0.0", "0.10.0")).toBeGreaterThan(0);
  expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
  expect(compareVersions("dev", "0.1.0")).toBeLessThan(0);
  // A nightly sits between the release before it and its own release, so 0.3.3 never "updates" it.
  expect(compareVersions("0.3.3", "0.3.4-nightly.20261019.4")).toBeLessThan(0);
  expect(compareVersions("0.3.4", "0.3.4-nightly.20261019.4")).toBeGreaterThan(0);
  expect(compareVersions("0.3.4-nightly.20261020.1", "0.3.4-nightly.20261019.4")).toBe(0);
});

test("the newest desktop release wins; addon tags, drafts and pre-releases are ignored", () => {
  const releases = [
    { tag_name: "addon-v0.3.3", html_url: "a" },
    { tag_name: "desktop-v0.2.0", html_url: "pre", prerelease: true },
    { tag_name: "desktop-v0.1.2", html_url: "https://github.com/Everloot/everloot/releases/tag/desktop-v0.1.2" },
    { tag_name: "desktop-v0.1.10", html_url: "ten" },
    { tag_name: "desktop-v9.9.9", html_url: "draft", draft: true },
    { tag_name: "nightly" },
  ];
  expect(newestDesktopRelease(releases)).toEqual({ version: "0.1.10", url: "ten" });
  expect(newestDesktopRelease([{ tag_name: "addon-v1.0.0" }])).toBeNull();
  expect(newestDesktopRelease("nope")).toBeNull();
});

test("a check says whether something newer exists and never downloads", async () => {
  const send = vi.fn(async () => new Response(JSON.stringify([{ tag_name: "desktop-v0.2.0", html_url: "u" }]), { status: 200 }));
  expect(await checkForUpdates("0.1.0", send as unknown as typeof fetch)).toEqual({ current: "0.1.0", latest: "0.2.0", url: "u", newer: true, notes: [], downloadUrl: null, publishedAt: null, sumsUrl: null, installable: false });
  expect(await checkForUpdates("0.2.0", send as unknown as typeof fetch)).toMatchObject({ newer: false });
  expect(send).toHaveBeenCalledTimes(2);
  const empty = vi.fn(async () => new Response("[]", { status: 200 }));
  expect(await checkForUpdates("0.1.0", empty as unknown as typeof fetch)).toMatchObject({ latest: null, newer: false });
  const down = vi.fn(async () => new Response("", { status: 503 }));
  await expect(checkForUpdates("0.1.0", down as unknown as typeof fetch)).rejects.toThrow(/503/);
});

test("the release list reads further pages until both the app and the addon have a release", async () => {
  // GitHub lists newest first, 100 at most per page: a run of addon releases and nightlies can push the app's release to a later page.
  const busy = Array.from({ length: 100 }, (_, i) => i % 2 ? { tag_name: `addon-v0.4.${i}` } : { tag_name: `nightly-2026110${i}`, prerelease: true });
  const pages = [busy, [{ tag_name: "desktop-v0.2.0", html_url: "u" }, { tag_name: "addon-v0.3.0" }], [{ tag_name: "desktop-v0.1.0" }]];
  const send = vi.fn(async (url: string) => new Response(JSON.stringify(pages[Number(new URL(url).searchParams.get("page")) - 1] ?? []), { status: 200 }));
  expect(await fetchReleases(send as unknown as typeof fetch)).toHaveLength(102);
  expect(send).toHaveBeenCalledTimes(2);
  expect(await checkForUpdates("0.1.0", send as unknown as typeof fetch)).toMatchObject({ latest: "0.2.0", newer: true });
  expect(send.mock.calls[0][0]).toMatch(/per_page=100&page=1$/);

  // Both found on the first page, or a short page: one request. A list that never has them stops after five pages.
  const both = vi.fn(async () => new Response(JSON.stringify([{ tag_name: "desktop-v0.2.0" }, { tag_name: "addon-v0.3.0" }]), { status: 200 }));
  await fetchReleases(both as unknown as typeof fetch);
  expect(both).toHaveBeenCalledTimes(1);
  const endless = vi.fn(async () => new Response(JSON.stringify(busy), { status: 200 }));
  expect(await fetchReleases(endless as unknown as typeof fetch)).toHaveLength(500);
  expect(endless).toHaveBeenCalledTimes(5);

  // Any page that fails fails the check, as one failed request always has.
  const flaky = vi.fn(async (url: string) => url.endsWith("page=1") ? new Response(JSON.stringify(busy), { status: 200 }) : new Response("", { status: 502 }));
  await expect(fetchReleases(flaky as unknown as typeof fetch)).rejects.toThrow(/502/);
});

test("the page may open a browser only to https on the project's own hosts", () => {
  expect(allowedExternal("https://everloot.app/upload")).toBe(true);
  expect(allowedExternal("https://github.com/Everloot/everloot/releases")).toBe(true);
  expect(allowedExternal("http://everloot.app/")).toBe(false);
  expect(allowedExternal("https://evil.example/everloot.app")).toBe(false);
  expect(allowedExternal("file:///C:/Windows")).toBe(false);
  expect(allowedExternal("not a url")).toBe(false);
});

test("a provider's own get-key page opens, exactly as the catalogue gives it and nothing else on that host", () => {
  const links = PROVIDER_PRESETS.flatMap((p) => (p.getKey ? [p.getKey.href] : []));
  expect(links.length).toBeGreaterThan(15);
  for (const href of links) {
    expect(allowedExternal(href)).toBe(true);
    const u = new URL(href);
    expect(allowedExternal(href.replace("https:", "http:"))).toBe(false);
    expect(allowedExternal(`https://user:pw@${u.host}${u.pathname}${u.search}`)).toBe(false);
    expect(allowedExternal(`${href.replace(/\/$/, "")}/extra`)).toBe(false);
    expect(allowedExternal(`${href}${u.search ? "&" : "?"}next=https://evil.example`)).toBe(false);
    expect(allowedExternal(`${href}#frag`)).toBe(false);
    expect(allowedExternal(`https://${u.hostname}.evil.example${u.pathname}`)).toBe(false);
    expect(allowedExternal(`https://evil-${u.hostname}${u.pathname}`)).toBe(false);
  }
  // Another path on a provider's host is not granted, nor is a custom server's address.
  expect(allowedExternal("https://openrouter.ai/")).toBe(false);
  expect(allowedExternal("https://platform.deepseek.com/")).toBe(false);
  expect(allowedExternal("https://llm.example.test/v1")).toBe(false);
  expect(allowedExternal("https://openrouter.ai:8443/keys")).toBe(false);
  // The project's own hosts keep working.
  expect(allowedExternal("https://everloot.app/upload")).toBe(true);
});

test("a release's changes are read from the changelog section or GitHub's generated list", () => {
  const changelog = [
    "## [desktop-v0.2.0] - 2026-10-21",
    "",
    "### Added",
    "- Desktop App: Chat answers appear as the model writes them, with the tool it is running shown while",
    "  it looks something up. Each answer has a Copy button.",
    "",
    "### Fixed",
    "- Desktop App: an `Everloot.lua` written after start is found. See [the README](https://example.test).",
    "",
    "```",
    "- not a bullet, inside code",
    "```",
    "| System | File |",
  ].join("\n");
  expect(releaseNotes(changelog)).toEqual([
    { text: "Desktop App: Chat answers appear as the model writes them, with the tool it is running shown while it looks something up. Each answer has a Copy button.", author: null, pr: null },
    { text: "Desktop App: an Everloot.lua written after start is found. See the README.", author: null, pr: null },
  ]);
  const generated = [
    "## What's Changed",
    "### Addon",
    "* feat(addon): census of your characters by @CDVolvik in https://github.com/Everloot/everloot/pull/116",
    "* chore(web): bump by @dependabot[bot] in https://github.com/Everloot/everloot/pull/131",
    "",
    "**Full Changelog**: https://github.com/x",
  ].join("\n");
  expect(releaseNotes(generated)).toEqual([
    { text: "feat(addon): census of your characters", author: "CDVolvik", pr: 116 },
    { text: "chore(web): bump", author: "dependabot[bot]", pr: 131 },
  ]);
  expect(releaseNotes("Just prose, no list.")).toEqual([]);
});

test("the download is this system's file from the release, and the popover gets the notes with it", () => {
  const names = ["win-x64-setup.exe", "win-x64-portable.exe", "mac-arm64.dmg", "linux-x86_64.AppImage"].map((n) => `Everloot-DesktopApp-0.2.0-${n}`).concat("SHA256SUMS");
  const assets = names.map((name) => ({ name, browser_download_url: `https://github.com/Everloot/everloot/releases/download/desktop-v0.2.0/${name}` }));
  expect(downloadFor(assets, "win32")).toMatch(/setup\.exe$/);
  expect(downloadFor(assets, "win32", true)).toMatch(/portable\.exe$/);
  expect(downloadFor(assets, "darwin")).toMatch(/\.dmg$/);
  expect(downloadFor(assets, "linux")).toMatch(/\.AppImage$/);
  expect(downloadFor(assets, "freebsd")).toBeNull();
  expect(downloadFor("nope", "win32")).toBeNull();
  const releases = [
    { tag_name: "desktop-v0.2.0", html_url: "page", body: "### Fixed\n- One fix.", assets, published_at: "2026-10-21T10:00:00Z" },
    { tag_name: "desktop-v0.1.0", html_url: "old" },
  ];
  expect(updateFrom(releases, "0.1.0", "win32")).toEqual({
    current: "0.1.0", latest: "0.2.0", url: "page", newer: true,
    notes: [{ text: "One fix.", author: null, pr: null }], downloadUrl: assets[0].browser_download_url, publishedAt: "2026-10-21T10:00:00Z",
    sumsUrl: assets[4].browser_download_url, installable: true,
  });
  // Only the Windows installer can be swapped in place; the portable exe, a disk image and an AppImage cannot.
  expect(updateFrom(releases, "0.1.0", "win32", true).installable).toBe(false);
  expect(updateFrom(releases, "0.1.0", "darwin").installable).toBe(false);
  expect(updateFrom(releases, "0.1.0", "linux").installable).toBe(false);
  expect(updateFrom(releases, "0.2.0", "win32").newer).toBe(false);
});
