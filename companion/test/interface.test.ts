import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { ANSWERS_ADDON, INTERFACE, writeAnswersAddon } from "../src/bridge/answers";
import { PRICES_ADDON, writePricesAddon } from "../src/prices";

// The slot addons copy their interface number from INTERFACE, not from the addon's TOC (the packaged
// app has no repo to read). When the TOC moves to a new client build, these fail until INTERFACE follows.
const ADDON_TOC = new URL("../../addon/Everloot.toc", import.meta.url);
const interfaceOf = (toc: string) => /^## Interface: *(\S+?)\r?$/m.exec(toc)?.[1];

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), "everloot-interface-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

test("INTERFACE is the addon TOC's interface number", () => {
  const addon = interfaceOf(readFileSync(ADDON_TOC, "utf8"));
  expect(addon).toMatch(/^\d+$/);
  expect(INTERFACE).toBe(addon);
});

test("the Answers and Prices slot TOCs written to disk carry the addon's interface number", () => {
  const addon = interfaceOf(readFileSync(ADDON_TOC, "utf8"));
  const addons = dir();
  writeAnswersAddon(addons, []);
  writePricesAddon(addons, []);
  for (const name of [ANSWERS_ADDON, PRICES_ADDON]) {
    expect(interfaceOf(readFileSync(join(addons, name, `${name}.toc`), "utf8")), name).toBe(addon);
  }
});
