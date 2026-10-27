import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createSentState } from "../src/sent-state";
import { uploadFile } from "../src/uploader";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const install = "abcd-1234-ef56-7890";
function workspace() {
  const d = mkdtempSync(join(tmpdir(), "everloot-origin-")); dirs.push(d);
  const file = join(d, "Everloot.lua");
  writeFileSync(file, `EverlootDB = { version = "0.3.12", installId = "${install}", records = { loot = {
    { eventId = "epoch:1", capturedAt = "2026-10-27T00:00:00Z", sourceNpcId = 42, sourceEvidence = "loot-api", items = { { itemId = 5, count = 1 } } },
  } } }`);
  const state = createSentState(join(d, "sent.json"));
  const send = (async () => Response.json({ ok: true, persisted: true, uploadId: "u-1", accepted: [{ index: 0, kind: "loot" }], rejected: [] })) as typeof fetch;
  return { file, state, fetch: send };
}

test("a receipt from a test site does not suppress the same upload to production", async () => {
  const w = workspace();
  expect((await uploadFile(w.file, { ...w, endpoint: "https://test.example" })).sent).toBe(1);
  expect((await uploadFile(w.file, { ...w, endpoint: "https://everloot.app" })).sent).toBe(1);
  expect((await uploadFile(w.file, { ...w, endpoint: "https://test.example/" })).sent).toBe(0);
  expect((await uploadFile(w.file, { ...w, endpoint: "https://everloot.app/" })).sent).toBe(0);
});

test("legacy receipts apply to production while a different site gets its own upload", async () => {
  const w = workspace();
  w.state.add(install, ["epoch:1"]);
  expect((await uploadFile(w.file, { ...w, endpoint: "https://everloot.app" })).sent).toBe(0);
  expect((await uploadFile(w.file, { ...w, endpoint: "https://test.example" })).sent).toBe(1);
});
