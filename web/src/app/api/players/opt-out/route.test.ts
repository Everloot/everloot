import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ suppress: vi.fn(), request: vi.fn(), revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/player-store", () => ({ playerStore: () => ({ suppress: mocks.suppress }) }));
vi.mock("@/lib/intake-quota", () => ({ intakeQuota: { form: mocks.request } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath, revalidateTag: mocks.revalidateTag }));

import { POST } from "./route";

const form = (fields: Record<string, string>) => new Request("https://everloot.app/api/players/opt-out", {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields),
});
const where = (r: Response) => new URL(r.headers.get("location")!).search;

beforeEach(() => {
  vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
  mocks.suppress.mockReset().mockResolvedValue(undefined);
  mocks.request.mockReset().mockResolvedValue({ allowed: true, retryAfter: 0 });
  mocks.revalidatePath.mockReset();
  mocks.revalidateTag.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

test("with the switch off it is a 404 and records nothing", async () => {
  vi.stubEnv("EVERLOOT_PLAYER_PAGES", "");
  expect((await POST(form({ name: "Thrallina", realm: "Forever Pioneer" }))).status).toBe(404);
  expect(mocks.suppress).not.toHaveBeenCalled();
});

test("a valid request hides the character, clears the caches and sends the person back with a confirmation", async () => {
  const response = await POST(form({ name: " Thrallina ", realm: "Forever Pioneer" }));
  expect(response.status).toBe(303);
  expect(where(response)).toBe("?done=1");
  expect(mocks.suppress).toHaveBeenCalledWith("Forever Pioneer", "Thrallina");
  expect(mocks.revalidateTag).toHaveBeenCalledWith("players");
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/players/forever/forever-pioneer/thrallina");
  // Realm normalization and case-insensitive lookup let aliases have separate ISR entries.
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/players/[ruleset]/[realm]/[name]", "page");
});

test("a name or realm that is not one is refused before anything is recorded", async () => {
  const bad: Record<string, string>[] = [{ name: "Bob1", realm: "Forever Pioneer" }, { name: "Thrallina", realm: "" }, { name: "<b>", realm: "Forever Pioneer" }, {}];
  for (const fields of bad) {
    expect(where(await POST(form(fields)))).toContain("error=invalid");
  }
  expect(mocks.suppress).not.toHaveBeenCalled();
});

test("the same limits as every other write apply, and a storage failure says so", async () => {
  mocks.request.mockResolvedValue({ allowed: false, retryAfter: 60 });
  expect(where(await POST(form({ name: "Thrallina", realm: "Forever Pioneer" })))).toContain("error=limit");
  mocks.request.mockResolvedValue({ allowed: true, retryAfter: 0 });
  mocks.suppress.mockRejectedValue(new Error("down"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(where(await POST(form({ name: "Thrallina", realm: "Forever Pioneer" })))).toContain("error=storage");
  expect(mocks.revalidateTag).not.toHaveBeenCalled();
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
});
