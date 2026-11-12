import { beforeEach, expect, test, vi } from "vitest";
import { completionRef } from "@/lib/character-links";
const mocks = vi.hoisted(() => ({ authQuery: vi.fn(), publicCharacter: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ authQuery: mocks.authQuery }));
vi.mock("@/lib/character-links-store", () => ({ publicCharacter: mocks.publicCharacter }));
import { attributeUploads, contributorIdentity } from "./attribution";
const env = { EVERLOOT_OPS_HMAC_SECRET: "ops-secret", EVERLOOT_CHARACTER_KEY: "character-secret-at-least-thirty-two-characters", EVERLOOT_SHOWCASE: "1", EVERLOOT_CHARACTER_LINKS: "1" };
const user = "11111111-1111-4111-8111-111111111111", link = "22222222-2222-4222-8222-222222222222", upload = "33333333-3333-4333-8333-333333333333";
const body = { consent: true, uploadIds: [upload], installId: "my-install", completionKeys: ["1234abcd", "5678abcd"], linkId: link };
function own(overrides = {}) { return { id: link, user_id: user, status: "linked", ruleset: "forever", name: "Mychar", realm: "Realm", completion_ref: completionRef(body.installId, "1234abcd", env.EVERLOOT_CHARACTER_KEY), ...overrides }; }
beforeEach(() => { vi.resetAllMocks(); mocks.publicCharacter.mockResolvedValue({ name: "Mychar", realm: "Realm" }); });

test("explicit opt-in credits only requested receipts and selected matching link, never historical installs", async () => {
  mocks.authQuery.mockResolvedValueOnce([own()]).mockResolvedValueOnce([{ id: upload, install_id: body.installId }]).mockResolvedValueOnce(true);
  expect(await attributeUploads(user, body, env)).toEqual({ ok: true });
  const [path, init] = mocks.authQuery.mock.calls[2];
  expect(path).toBe("rpc/attribute_ops_uploads");
  const written = JSON.parse(init.body);
  expect(written.p_upload_ids).toEqual([upload]);
  expect(written.p_link_id).toBe(link);
  expect(written.p_completion_refs).toHaveLength(2);
  expect(written.p_install_key).toMatch(/^[a-f0-9]{64}$/);
  expect(written).not.toHaveProperty("name");
});

test.each([null, own({ user_id: "foreign" }), own({ status: "frozen" }), own({ completion_ref: "different" })])("foreign, missing, frozen or unrelated link cannot be attributed", async (row) => {
  mocks.authQuery.mockResolvedValueOnce(row ? [row] : []);
  expect(await attributeUploads(user, body, env)).toEqual({ ok: false });
  expect(mocks.authQuery).toHaveBeenCalledTimes(1);
});

test("a private or suppressed linked character cannot be attributed", async () => {
  mocks.authQuery.mockResolvedValueOnce([own()]); mocks.publicCharacter.mockResolvedValue(null);
  expect(await attributeUploads(user, body, env)).toEqual({ ok: false });
  expect(mocks.authQuery).toHaveBeenCalledTimes(1);
});

test.each([{ rows: [] }, { rows: [{ id: upload, install_id: "foreign-install" }] }])("nonexistent or foreign uploads are refused", async ({ rows }) => {
  mocks.authQuery.mockResolvedValueOnce([own()]).mockResolvedValueOnce(rows);
  expect(await attributeUploads(user, body, env)).toEqual({ ok: false });
  expect(mocks.authQuery).toHaveBeenCalledTimes(2);
});

test("no explicit consent or no matching file key performs no private reads", async () => {
  expect(await attributeUploads(user, { ...body, consent: false }, env)).toEqual({ ok: false });
  expect(await attributeUploads(user, { ...body, completionKeys: [] }, env)).toEqual({ ok: false });
  expect(mocks.authQuery).not.toHaveBeenCalled();
});

test("detail checks live eligibility on every read and removes revoked identity", async () => {
  mocks.authQuery.mockResolvedValueOnce([{ name: "Mychar", realm: "Realm", class: "MAGE", level: 60, ruleset: "forever", opted_at: "2026-11-12T12:00:00Z" }]).mockResolvedValueOnce([]);
  const result = await contributorIdentity("a".repeat(64), env);
  expect(result).toMatchObject({ attribution: "opted-in", identity: { name: "Mychar", provenance: "contributor-opt-in", attributedAt: "2026-11-12T12:00:00Z" } });
  expect(await contributorIdentity("a".repeat(64), env)).toEqual({ identity: null, attribution: "anonymous" });
  expect(mocks.authQuery).toHaveBeenCalledTimes(2);
});

test("detail fails closed if feature disabled, id invalid or current visibility unavailable", async () => {
  expect(await contributorIdentity("raw-install", env)).toEqual({ identity: null, attribution: "anonymous" });
  expect(await contributorIdentity("a".repeat(64), {})).toEqual({ identity: null, attribution: "unavailable" });
  mocks.authQuery.mockRejectedValue(new Error("private detail"));
  expect(await contributorIdentity("a".repeat(64), env)).toEqual({ identity: null, attribution: "unavailable" });
});
