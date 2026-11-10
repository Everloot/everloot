// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import DesktopDownload, { desktopOS } from "./DesktopDownload";

const files = [
  { os: "Windows", needs: "Windows 10 or 11, 64-bit", file: { url: "/setup.exe" } },
  { os: "Windows", needs: "Windows 10 or 11, 64-bit", file: { url: "/portable.exe" } },
  { os: "macOS", needs: "Apple silicon (M1 or newer), macOS 13 Ventura or later. No Intel build yet", file: { url: "/mac.dmg" } },
  { os: "Linux", needs: "64-bit x86 Linux", file: { url: "/linux.AppImage" } },
];
afterEach(() => vi.unstubAllGlobals());

test("server render is neutral even when the server has a user agent", () => {
  vi.stubGlobal("navigator", { userAgentData: { platform: "Windows" }, userAgent: "Windows" });
  const html = renderToStaticMarkup(<DesktopDownload files={files} />);
  expect(html).toContain('href="#desktop-files"');
  expect(html).toContain("Choose your download");
  expect(html).not.toContain("Download for Windows");
});

test.each([
  ["Windows", "", "Windows", "/setup.exe"],
  ["macOS", "", "macOS", "/mac.dmg"],
  ["", "Mozilla/5.0 (Macintosh; Intel Mac OS X)", "macOS", "/mac.dmg"],
  ["", "Mozilla/5.0 (X11; Linux x86_64)", "Linux", "/linux.AppImage"],
  ["Linux", "Android", null, "#desktop-files"],
  ["macOS", "iPad", null, "#desktop-files"],
  ["", "unknown", null, "#desktop-files"],
])("client selects %s / %s", async (platform, userAgent, os, href) => {
  expect(desktopOS(platform!, userAgent!)).toBe(os);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { userAgentData: { platform }, userAgent });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<DesktopDownload files={files} />));
    expect(container.querySelector("a")?.getAttribute("href")).toBe(href);
    expect(container.querySelector("a")?.textContent).toBe(os ? `Download for ${os}${os === "macOS" ? " (Apple silicon)" : ""}` : "Choose your download");
    expect(container.querySelector("p")?.textContent).toBe(files.find((entry) => entry.os === os)?.needs);
  } finally {
    await act(async () => root.unmount());
  }
});

test("a missing OS artifact leaves the full list reachable", () => {
  expect(renderToStaticMarkup(<DesktopDownload files={[]} />)).toContain('href="#desktop-files"');
});
