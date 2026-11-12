import { afterEach, beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), listLinks: vi.fn(), attributeUploads: vi.fn(), revokeAttribution: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: mocks.getUser, siteUrl: () => "https://everloot.app" }));
vi.mock("@/lib/character-links-store", () => ({ listLinks: mocks.listLinks }));
vi.mock("@/lib/ops/attribution", async (original) => ({ ...await original<typeof import("@/lib/ops/attribution")>(), attributeUploads: mocks.attributeUploads, revokeAttribution: mocks.revokeAttribution }));
import { DELETE, GET, POST } from "./route";
const req = (body: unknown, origin = "https://everloot.app") => new Request("https://everloot.app/api/me/contributions", { method: "POST", headers: { origin }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.getUser.mockResolvedValue({ id: "operator" }); vi.stubEnv("EVERLOOT_CHARACTER_LINKS", "1"); vi.stubEnv("EVERLOOT_SHOWCASE", "1"); });
afterEach(() => vi.unstubAllEnvs());

test("anonymous, cross-origin and account-switched writes never save attribution", async () => {
  expect((await POST(req({ expectedUserId: "operator" }, "https://evil.test"))).status).toBe(403);
  expect(mocks.getUser).not.toHaveBeenCalled();
  mocks.getUser.mockResolvedValueOnce(null);
  expect((await POST(req({ expectedUserId: "operator" }))).status).toBe(401);
  expect((await POST(req({ expectedUserId: "other" }))).status).toBe(409);
  expect(mocks.attributeUploads).not.toHaveBeenCalled();
});

test("authenticated explicit save returns refusal without private link details", async () => {
  mocks.attributeUploads.mockResolvedValue({ ok: false });
  const res = await POST(req({ expectedUserId: "operator", consent: true }));
  expect(res.status).toBe(400);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(await res.json()).toEqual({ error: "Choose your own public, linked character with a matching key in this file." });
});

test("authenticated save and revoke use only current session account", async () => {
  mocks.attributeUploads.mockResolvedValue({ ok: true });
  expect((await POST(req({ expectedUserId: "operator", consent: true }))).status).toBe(200);
  expect(mocks.attributeUploads).toHaveBeenCalledWith("operator", expect.objectContaining({ consent: true }));
  expect((await DELETE(req({ expectedUserId: "operator" }))).status).toBe(200);
  expect(mocks.revokeAttribution).toHaveBeenCalledWith("operator");
});

test("options reveal only the signed-in account's eligible links", async () => {
  mocks.listLinks.mockResolvedValue([
    { id: "yes", name: "Mychar", realm: "Realm", status: "linked", page: { public: true } },
    { id: "frozen", name: "Frozen", status: "frozen", page: { public: true } },
    { id: "private", name: "Private", status: "linked", page: { public: false } },
  ]);
  const res = await GET();
  expect(await res.json()).toEqual({ userId: "operator", links: [{ id: "yes", name: "Mychar", realm: "Realm" }] });
  expect(mocks.listLinks).toHaveBeenCalledWith("operator");
});
