import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { linkReceiptKey, linkSummary, sendLinks } from "../src/link-sender";
import { createSentState } from "../src/sent-state";
import { uploadFile } from "../src/uploader";

const KEY = `evl_${"ab".repeat(32)}`;
const SITE = "https://everloot.example";
const INSTALL = "abcd-1234-ef56-7890";
const GUID = "Player-4395-0A1B2C3D";

/** A link row as `/everloot link` writes it, plus one loot row, in the file's own shape. */
function link(n: number, fields: Record<string, string | number> = {}): string {
  const row: Record<string, string | number> = {
    eventId: `character_link:${n}`, capturedAt: "2026-11-01T18:00:00Z", code: `EL-AAAA-${String(n).padStart(2, "0")}`, name: "Thrallina",
    realm: "Forever Pioneer", race: "Orc", class: "SHAMAN", level: 24, faction: "Horde", guid: GUID, completionKey: "0a1b2c3d", ...fields,
  };
  return `{${Object.entries(row).map(([k, v]) => `["${k}"] = ${typeof v === "number" ? v : JSON.stringify(v)}`).join(", ")}},`;
}
function workspace(links: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "everloot-links-"));
  const file = join(dir, "Everloot.lua");
  const loot = `{["eventId"] = "epoch:1", ["capturedAt"] = "2026-11-01T00:00:00Z", ["sourceNpcId"] = 42, ["sourceEvidence"] = "loot-api", ["items"] = {{["itemId"] = 5, ["count"] = 1}}},`;
  writeFileSync(file, `EverlootDB = {\n["version"] = "0.3.14",\n["installId"] = "${INSTALL}",\n["records"] = {\n["character_link"] = {\n${links.join("\n")}\n},\n["loot"] = {\n${loot}\n},\n},\n}\n`);
  return { file, state: createSentState(join(dir, "state", "sent.json")) };
}

/** A fake site: answers each request with `answer(records)`, and remembers every request. */
function site(answer: (records: { code: string }[]) => Response) {
  const calls: { url: string; init: RequestInit; records: { code: string; guid: string }[] }[] = [];
  const send = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const records = JSON.parse(String(init?.body)).records;
    calls.push({ url: String(url), init: init!, records });
    return answer(records);
  });
  return { send: send as unknown as typeof fetch, calls };
}
const results = (...statuses: string[]) => Response.json({
  results: statuses.map((status, index) => status === "linked" || status === "frozen"
    ? { index, status, name: "Thrallina", realm: "Forever Pioneer", message: "ok" }
    : { index, status, message: status === "refused" ? "This code has expired. Make a new one." : "Send it again in a minute." }),
}, { status: statuses.every((s) => s === "retry") ? 503 : 200 });

describe("sending link rows", () => {
  test("they go only to the account's link endpoint, with the key, as protocol rows", async () => {
    const { file, state } = workspace([link(1)]);
    const api = site(() => results("linked"));
    const r = await sendLinks(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
    expect(r).toMatchObject({ linked: ["Thrallina of Forever Pioneer"], waiting: 0, problem: null });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].url).toBe(`${SITE}/api/me/characters/links`);
    expect(api.calls[0].init.method).toBe("POST");
    expect((api.calls[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(api.calls[0].init.redirect).toBe("error");
    expect(api.calls[0].records).toEqual([expect.objectContaining({ kind: "character_link", installId: INSTALL, code: "EL-AAAA-01", guid: GUID })]);
    // Only link rows: the loot row in the same file is the upload's.
    expect(api.calls[0].records).toHaveLength(1);
    expect(linkSummary(r)).toBe("linked Thrallina of Forever Pioneer");
  });

  test("an answered row is not sent again; a new code is", async () => {
    const { file, state } = workspace([link(1)]);
    const api = site((records) => results(...records.map(() => "linked")));
    await sendLinks(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
    expect(await sendLinks(file, { endpoint: SITE, key: KEY, state, fetch: api.send })).toMatchObject({ linked: [], waiting: 0 });
    expect(api.calls).toHaveLength(1);
    expect(state.has(linkReceiptKey(INSTALL, SITE), "character_link:1")).toBe(true);
    // The intake's own receipts are kept apart: the link row is not marked as an uploaded event.
    expect(state.has(INSTALL, "character_link:1") || state.has(`${SITE}|${INSTALL}`, "character_link:1")).toBe(false);
    const again = workspace([link(1), link(2)]);
    await sendLinks(again.file, { endpoint: SITE, key: KEY, state: again.state, fetch: api.send });
  });

  test("frozen and refused rows are answered and kept handled; a row to send again stays", async () => {
    const { file, state } = workspace([link(1), link(2), link(3)]);
    const api = site(() => results("frozen", "refused", "retry"));
    const r = await sendLinks(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
    expect(r).toMatchObject({ frozen: ["Thrallina of Forever Pioneer"], refused: ["This code has expired. Make a new one."], waiting: 1 });
    expect(linkSummary(r)).toContain("frozen: another account linked it too");
    expect(linkSummary(r)!.toLowerCase()).not.toContain("verified");
    const next = site(() => results("linked"));
    await sendLinks(file, { endpoint: SITE, key: KEY, state, fetch: next.send });
    expect(next.calls[0].records.map((r) => r.code)).toEqual(["EL-AAAA-03"]);
  });

  test("without a key nothing is sent and the rows wait", async () => {
    const { file, state } = workspace([link(1)]);
    const api = site(() => results("linked"));
    const r = await sendLinks(file, { endpoint: SITE, key: null, state, fetch: api.send });
    expect(api.calls).toHaveLength(0);
    expect(r).toMatchObject({ waiting: 1, problem: expect.stringContaining("Sign in") });
  });

  test.each([
    [401, { error: "This API key is not valid or was revoked." }, /revoked/],
    [403, { error: "This key can't link characters. Reconnect the app to allow it." }, /Reconnect the app/],
    [404, { error: "Not found" }, /not switched on/],
    [500, {}, /HTTP 500/],
  ])("a %i keeps every row for next time and says why", async (status, body, said) => {
    const { file, state } = workspace([link(1), link(2)]);
    const api = site(() => Response.json(body, { status }));
    const r = await sendLinks(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
    expect(r).toMatchObject({ linked: [], waiting: 2, problem: expect.stringMatching(said) });
    expect(state.has(linkReceiptKey(INSTALL, SITE), "character_link:1")).toBe(false);
  });

  test("a network failure keeps the rows", async () => {
    const { file, state } = workspace([link(1)]);
    const send = vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect(await sendLinks(file, { endpoint: SITE, key: KEY, state, fetch: send })).toMatchObject({ waiting: 1, problem: expect.stringContaining("Could not reach") });
  });

  test("more than ten rows go ten to a request", async () => {
    const { file, state } = workspace(Array.from({ length: 12 }, (_, i) => link(i + 1, { guid: `Player-4395-${String(i + 1).padStart(8, "0")}` })));
    const api = site((records) => results(...records.map(() => "linked")));
    const r = await sendLinks(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
    expect(api.calls.map((c) => c.records.length)).toEqual([10, 2]);
    expect(r.linked).toHaveLength(12);
  });

  test("a row the site would not read is not sent", async () => {
    const { file, state } = workspace([link(1, { code: "hello" })]);
    const api = site(() => results("linked"));
    const r = await sendLinks(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
    expect(api.calls).toHaveLength(0);
    expect(r.refused).toHaveLength(1);
  });
});

test("the upload never carries a link row: the intake sees the loot row only", async () => {
  const { file, state } = workspace([link(1)]);
  const bodies: string[] = [];
  const send = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(String(init?.body));
    const records = JSON.parse(String(init?.body)).records as { kind: string }[];
    return Response.json({ ok: true, persisted: true, uploadId: "u", accepted: records.map((r, index) => ({ index, kind: r.kind })), rejected: [] });
  }) as unknown as typeof fetch;
  const r = await uploadFile(file, { endpoint: SITE, fetch: send, state, census: true, players: true });
  expect(r.sent).toBe(1);
  for (const secret of ["character_link", GUID, "EL-AAAA-01"]) expect(bodies.join("")).not.toContain(secret);
});
