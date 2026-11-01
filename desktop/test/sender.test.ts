import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { allowedPermission, fromAppPage } from "../src/main/sender";

const page = join("Everloot Desktop App", "resources", "app.asar", "dist", "renderer", "index.html");
const pageUrl = pathToFileURL(page).href;
const top = (url: string) => ({ url, parent: null });

test("the app's own page, at the top of the window, may call", () => {
  expect(fromAppPage(top(pageUrl), page)).toBe(true);
  expect(fromAppPage(top(`${pageUrl}#market`), page)).toBe(true);
});

test.runIf(process.platform === "win32")("on Windows the page is recognized however Chromium spells its file URL", () => {
  const chromium = pageUrl.replace(/^file:\/\/\/([A-Z]):/, (_m, d: string) => `file:///${d.toLowerCase()}:`).replace(/%20/g, " ");
  expect(chromium).not.toBe(pageUrl);
  expect(fromAppPage(top(chromium), page)).toBe(true);
});

test("another file on disk may not call", () => {
  expect(fromAppPage(top(pathToFileURL(join("Downloads", "index.html")).href), page)).toBe(false);
  expect(fromAppPage(top(pageUrl.replace("index.html", "other.html")), page)).toBe(false);
  expect(fromAppPage(top(pageUrl.replace("file:///", "file://fileserver/")), page)).toBe(false);
});

test("a web page may not call", () => {
  expect(fromAppPage(top("https://everloot.app/"), page)).toBe(false);
  expect(fromAppPage(top("http://localhost:9333/index.html"), page)).toBe(false);
});

test("a frame inside the page may not call, even one showing the same file", () => {
  expect(fromAppPage({ url: pageUrl, parent: top(pageUrl) }, page)).toBe(false);
});

test("a frame that is gone, or has no address, may not call", () => {
  expect(fromAppPage(null, page)).toBe(false);
  expect(fromAppPage(undefined, page)).toBe(false);
  expect(fromAppPage(top(""), page)).toBe(false);
  expect(fromAppPage(top("not a url"), page)).toBe(false);
});

test("the page is granted clipboard writes and nothing else", () => {
  expect(allowedPermission("clipboard-sanitized-write")).toBe(true);
  for (const p of ["clipboard-read", "media", "geolocation", "notifications", "midi", "fullscreen", "openExternal", "pointerLock", "unknown"]) {
    expect(allowedPermission(p)).toBe(false);
  }
});
