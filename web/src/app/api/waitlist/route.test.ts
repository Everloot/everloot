import { beforeEach, expect, test, vi } from "vitest";

const deps = vi.hoisted(() => ({ request: vi.fn(), putWaitlist: vi.fn() }));
vi.mock("@/lib/intake-quota", () => ({ intakeQuota: { form: deps.request } }));
vi.mock("@/lib/upload-store", () => ({ uploadStore: { putWaitlist: deps.putWaitlist } }));

import { POST } from "./route";

const signup = (email = "Player@Example.com") =>
  new Request("https://everloot.app/api/waitlist", { method: "POST", body: JSON.stringify({ toolSlug: "auctions", email }) });

beforeEach(() => {
  deps.request.mockReset().mockResolvedValue({ allowed: true, retryAfter: 0 });
  deps.putWaitlist.mockReset().mockResolvedValue(true);
});

test("a signup passes the shared request quota before it is stored", async () => {
  const response = await POST(signup());
  expect(response.status).toBe(200);
  expect(deps.request).toHaveBeenCalledTimes(1);
  expect(deps.putWaitlist).toHaveBeenCalledWith(expect.objectContaining({ toolSlug: "auctions", email: "player@example.com" }));
});

test("a denied quota is 429 with retry-after and stores nothing", async () => {
  deps.request.mockResolvedValue({ allowed: false, retryAfter: 120 });
  const response = await POST(signup());
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("120");
  expect(deps.putWaitlist).not.toHaveBeenCalled();
});

test("quota storage failure fails closed and stores nothing", async () => {
  deps.request.mockRejectedValue(new Error("Quota storage unavailable"));
  const response = await POST(signup());
  expect(response.status).toBe(503);
  expect(deps.putWaitlist).not.toHaveBeenCalled();
});

test("an address with a multi-part domain is accepted", async () => {
  const response = await POST(signup("raider@mail.example.co.uk"));
  expect(response.status).toBe(200);
});

test("a long run of dots is rejected at once, without backtracking through it", async () => {
  // The old pattern took quadratic time on this shape (seconds here), so one large body could hold the handler for hours.
  const started = performance.now();
  const response = await POST(signup(`!@!.${"!.".repeat(50_000)}@`));
  expect(performance.now() - started).toBeLessThan(500);
  expect(response.status).toBe(422);
  expect(deps.putWaitlist).not.toHaveBeenCalled();
});

test("a domain with an empty label is rejected", async () => {
  for (const email of ["a@b..c", "a@.b.c", "a@b.c."]) {
    expect((await POST(signup(email))).status).toBe(422);
  }
  expect(deps.putWaitlist).not.toHaveBeenCalled();
});
