import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { latestAddonRelease } from "@/lib/addon-release";
import { servedFile } from "@/lib/everloot-releases";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

import AddonPage from "./page";

const DL = "https://github.com/Everloot/everloot/releases/download";
const addon = latestAddonRelease()!;
const served = servedFile(addon.downloadPath)!;
const addonZip = { name: `Everloot-${addon.version}.zip`, size: served.size, digest: `sha256:${served.sha256}`, browser_download_url: `${DL}/addon-v${addon.version}/Everloot-${addon.version}.zip` };
const desktop = (name: string, size: number) => ({ name, size, digest: `sha256:${"b".repeat(64)}`, browser_download_url: `${DL}/desktop-v0.1.0/${name}` });
const releases = [
  {
    tag_name: "desktop-v0.1.0", html_url: "https://github.com/Everloot/everloot/releases/tag/desktop-v0.1.0", published_at: "2026-10-19T15:22:44Z", draft: false, prerelease: false,
    assets: [
      desktop("Everloot-DesktopApp-0.1.0-linux-x86_64.AppImage", 127995716),
      desktop("Everloot-DesktopApp-0.1.0-mac-arm64.dmg", 130617780),
      desktop("Everloot-DesktopApp-0.1.0-win-x64-portable.exe", 113085564),
      desktop("Everloot-DesktopApp-0.1.0-win-x64-setup.exe", 113304866),
      desktop("SHA256SUMS", 443),
    ],
  },
  {
    tag_name: `addon-v${addon.version}`, html_url: `https://github.com/Everloot/everloot/releases/tag/addon-v${addon.version}`, published_at: "2026-10-18T00:05:47Z", draft: false, prerelease: false,
    assets: [addonZip, { name: "SHA256SUMS", size: 85, digest: null, browser_download_url: `${DL}/addon-v${addon.version}/SHA256SUMS` }],
  },
];

const visible = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
async function render(answer: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(answer));
  return renderToStaticMarkup(await AddonPage());
}

afterEach(() => vi.unstubAllGlobals());

test("the download is clearly labelled Alpha with live-client checks pending", async () => {
  const html = await render(() => Promise.resolve(Response.json(releases)));
  expect(visible(html)).toContain("Alpha");
  expect(visible(html)).toContain("Live-client verification is pending");
});

test.each([
  { reason: "different bytes", zip: { ...addonZip, digest: `sha256:${"0".repeat(64)}` } },
  { reason: "different size", zip: { ...addonZip, size: served.size + 1 } },
  { reason: "different filename", zip: { ...addonZip, name: "another-addon.zip" } },
  { reason: "unknown digest", zip: { ...addonZip, digest: null } },
])("the site keeps its own checksum but hides release sums for $reason", async ({ zip }) => {
  const mismatched = releases.map((release) => release.tag_name === `addon-v${addon.version}`
    ? { ...release, assets: [zip, release.assets[1]] }
    : release);
  const html = await render(() => Promise.resolve(Response.json(mismatched)));
  expect(html).toContain(`href="${addon.downloadPath}"`);
  expect(html).toContain(served.sha256);
  expect(html).not.toContain(`href="${DL}/addon-v${addon.version}/SHA256SUMS"`);
  expect(html).toContain(`href="${DL}/desktop-v0.1.0/SHA256SUMS"`);
});

test("the addon and every desktop build are offered with version, date, size and checksum", async () => {
  const html = await render(() => Promise.resolve(Response.json(releases)));
  const text = visible(html);
  expect(html).toContain(`href="${addon.downloadPath}"`);
  expect(text).toContain(`Version ${addon.version}, Alpha, released 2026-10-18`);
  expect(text).toContain("Version 0.1.0, released 2026-10-19");
  for (const [label, size] of [["Windows installer", "108 MB"], ["Windows portable", "108 MB"], ["macOS disk image", "125 MB"], ["Linux AppImage", "122 MB"]]) {
    expect(text).toContain(`${label} (${size})`);
  }
  // Installer first, AppImage last, whatever order GitHub lists them in.
  expect(html.indexOf("win-x64-setup.exe")).toBeLessThan(html.indexOf("linux-x86_64.AppImage"));
  expect(html).toContain(`href="${DL}/desktop-v0.1.0/SHA256SUMS"`);
  expect(html).toContain(`href="${DL}/addon-v${addon.version}/SHA256SUMS"`);
  expect(html).toContain("b".repeat(64));
  // The addon's checksum is worked out from the zip the site serves.
  expect(html).toMatch(/<code[^>]*>[0-9a-f]{64}<\/code>/);
});

test("the page says the builds are unsigned and what Windows and macOS show", async () => {
  const text = visible(await render(() => Promise.resolve(Response.json(releases))));
  expect(text).toContain("not code-signed");
  expect(text).toContain("More info, then Run anyway");
  expect(text).toContain("Open Anyway");
  expect(text).not.toContain("opened by a person");
});

test("install steps, the upload page, privacy, data policy and source are linked", async () => {
  const html = await render(() => Promise.resolve(Response.json(releases)));
  expect(visible(html)).toContain("Interface/AddOns");
  for (const href of ["/upload", "/privacy", "https://github.com/Everloot/everloot/blob/main/docs/DATA_POLICY.md", "https://github.com/Everloot/everloot/tree/main/addon", "https://github.com/Everloot/everloot/tree/main/desktop"]) {
    expect(html).toContain(`href="${href}"`);
  }
});

test("when GitHub cannot be read the addon still downloads and the app points at the releases page", async () => {
  const html = await render(() => Promise.reject(new Error("offline")));
  expect(html).toContain(`href="${addon.downloadPath}"`);
  expect(visible(html)).toContain("could not be loaded right now");
  expect(html).toContain('href="https://github.com/Everloot/everloot/releases"');
  expect(html).not.toContain("DesktopApp-");
});

test("the old gold per hour address lands on a section that says where the calculator went", async () => {
  const html = await render(() => Promise.resolve(Response.json(releases)));
  expect(html).toContain('id="gold-per-hour"');
  expect(visible(html)).toContain("Gold per hour, now in the addon");
  expect(html).toContain('href="/tools/auctions"');
});

/** The JSON-LD blocks in the page. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const blocks = (html: string): Record<string, any>[] => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]!));

test("the addon and the Desktop App each carry a SoftwareApplication with the version, download and systems the page shows", async () => {
  const html = await render(() => Promise.resolve(Response.json(releases)));
  const apps = blocks(html).filter((b) => b["@type"] === "SoftwareApplication");
  expect(apps.map((a) => a.name)).toEqual(["Everloot addon", "Everloot Desktop App"]);
  const [addonApp, desktopApp] = apps;
  expect(addonApp).toMatchObject({ softwareVersion: addon.version, downloadUrl: `https://everloot.app${addon.downloadPath}`, url: "https://everloot.app/addon", offers: { price: "0" } });
  expect(addonApp).not.toHaveProperty("operatingSystem");
  expect(desktopApp).toMatchObject({ softwareVersion: "0.1.0", downloadUrl: "https://github.com/Everloot/everloot/releases/tag/desktop-v0.1.0", operatingSystem: "Windows, macOS, Linux" });
  for (const app of apps) {
    expect(visible(html)).toContain(app.description);
    expect(JSON.stringify(app)).not.toMatch(/aggregateRating|ratingValue/);
  }
  // Without the release list, only the addon the site serves is described.
  const offline = await render(() => Promise.reject(new Error("offline")));
  expect(blocks(offline).filter((b) => b["@type"] === "SoftwareApplication").map((a) => a.name)).toEqual(["Everloot addon"]);
});

test("the page says why to run the addon: what it records, what the site gives back and what it never collects", async () => {
  const html = await render(() => Promise.resolve(Response.json(releases)));
  const text = visible(html);
  for (const heading of ["Why run the addon", "What it records", "What the site gives back", "What it never collects or publishes"]) {
    expect(text).toContain(heading);
  }
  for (const href of ["/database", "/map", "/database/zones", "/docs/api", "/docs/mcp", "/methodology", "#privacy"]) {
    expect(html).toContain(`href="${href}"`);
  }
  // The census is described the way the data policy does: never a name, and on in a new install.
  expect(text).toContain("never a name");
  expect(text).toContain("on in a new install");
  expect(text).toContain("Your install id, and the address an upload came from, are never published");
  expect(text).toContain("never plays your character");
});

test("the page promises no fact before three installs agree and does not present a drop rate as certain", async () => {
  const text = visible(await render(() => Promise.resolve(Response.json(releases))));
  expect(text).toContain("A fact is shown when three installs agree on it");
  expect(text).toContain("the page says nothing is confirmed");
  expect(text).toContain("It is not a promise that the item will drop for you");
  expect(text).not.toMatch(/guarantee|always drops|100%/i);
});

test("the page names no internal path and no AI", async () => {
  const text = visible(await render(() => Promise.resolve(Response.json(releases))));
  expect(text).not.toMatch(/R21|Users[\/]|\.t3|\bAI\b|Claude|ChatGPT|GPT|Codex/);
});
