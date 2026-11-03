import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

const parse = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../../web/src/lib/sv-parse", async (original) => {
  const actual = await original<typeof import("../../web/src/lib/sv-parse")>();
  return { ...actual, parseEverlootLua: (text: string) => { parse.calls++; return actual.parseEverlootLua(text); } };
});
const { sendLinks } = await import("../src/link-sender");
const { createSentState } = await import("../src/sent-state");

test("a save with no link rows is not parsed a second time after the upload, and nothing is sent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "everloot-links-skip-"));
  const file = join(dir, "Everloot.lua");
  writeFileSync(file, `EverlootDB = {\n["version"] = "0.3.14",\n["installId"] = "abcd-1234-ef56-7890",\n["records"] = {\n["loot"] = {\n{["eventId"] = "epoch:1", ["capturedAt"] = "2026-11-01T00:00:00Z", ["sourceNpcId"] = 42, ["sourceEvidence"] = "loot-api", ["items"] = {{["itemId"] = 5, ["count"] = 1}}},\n},\n},\n}\n`);
  const send = vi.fn();
  const result = await sendLinks(file, { endpoint: "https://everloot.example", key: `evl_${"ab".repeat(32)}`, state: createSentState(join(dir, "sent.json")), fetch: send as unknown as typeof fetch });
  expect(result).toEqual({ linked: [], frozen: [], refused: [], waiting: 0, problem: null });
  expect(parse.calls).toBe(0);
  expect(send).not.toHaveBeenCalled();
});
