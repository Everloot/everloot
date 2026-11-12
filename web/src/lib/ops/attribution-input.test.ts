import { expect, test } from "vitest";
import { contributionFiles } from "./attribution-input";
import type { UploadSession } from "@/lib/upload-batches";

test("only this session's durable upload receipts are candidates, with own completion keys per install", () => {
  const session = { batches: [JSON.stringify({ records: [{ installId: "one" }] }), JSON.stringify({ records: [{ installId: "two" }] })],
    receipts: [{ ok: true, persisted: true, uploadId: "upload-one" }, { ok: false }], next: 2 } as UploadSession;
  const payload = { records: [
    { kind: "achievement_owned", installId: "one", characterKey: "1234abcd" },
    { kind: "character_link", installId: "one", completionKey: "5678abcd" },
    { kind: "player_seen", installId: "one", characterKey: "9999abcd", name: "Unrelated" },
    { kind: "achievement_owned", installId: "two", characterKey: "2222abcd" },
  ] };
  expect(contributionFiles(session, payload)).toEqual([{ installId: "one", uploadIds: ["upload-one"], completionKeys: ["1234abcd", "5678abcd"] }]);
});

test("mixed-character files preserve candidate keys without assigning every record to a character", () => {
  const session = { batches: [JSON.stringify({ records: [{ installId: "one" }] })], receipts: [{ ok: true, persisted: true, uploadId: "upload-one" }], next: 1 } as UploadSession;
  expect(contributionFiles(session, { records: [{ kind: "loot", installId: "one", name: "Observed" }] }))
    .toEqual([{ installId: "one", uploadIds: ["upload-one"], completionKeys: [] }]);
});
