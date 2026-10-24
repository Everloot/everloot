import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ suppressGuild: vi.fn(), request: vi.fn(), revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/player-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/player-store")>()),
  playerStore: () => ({ suppressGuild: mocks.suppressGuild }),
}));
vi.mock("@/lib/intake-quota", () => ({ intakeQuota: { request: mocks.request } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath, revalidateTag: mocks.revalidateTag, unstable_cache: <T,>(fn: T) => fn }));

import { POST } from "./route";

const form = (fields: Record<string, string>) => new Request("https://everloot.app/api/guilds/hide", {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields),
});
const where = (r: Response) => new URL(r.headers.get("location")!);

beforeEach(() => {
  vi.stubEnv("EVERLOOT_GUILDS", "1");
  mocks.suppressGuild.mockReset().mockResolvedValue(undefined);
  mocks.request.mockReset().mockResolvedValue({ allowed: true, retryAfter: 0 });
  mocks.revalidatePath.mockReset();
  mocks.revalidateTag.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); });

test("with the switch off it is a 404 and records nothing", async () => {
  vi.stubEnv("EVERLOOT_GUILDS", "");
  expect((await POST(form({ guild: "Night Watch", realm: "Forever Pioneer" }))).status).toBe(404);
  expect(mocks.suppressGuild).not.toHaveBeenCalled();
});

test("a plain form post hides the guild, clears the caches and sends the person back to the form", async () => {
  const response = await POST(form({ guild: " Night Watch ", realm: "Forever Pioneer" }));
  expect(response.status).toBe(303);
  expect(where(response).pathname).toBe("/guilds/hide");
  expect(where(response).search).toBe("?done=1");
  expect(mocks.suppressGuild).toHaveBeenCalledWith("Forever Pioneer", "Night Watch");
  expect(mocks.revalidateTag).toHaveBeenCalledWith("guilds");
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/guilds/forever-pioneer/night-watch");
});

test("a name or realm that is not one is refused before anything is recorded", async () => {
  for (const bad of [{ guild: "N", realm: "Forever Pioneer" }, { guild: "Night<Watch>", realm: "Forever Pioneer" }, { guild: "A".repeat(25), realm: "Forever Pioneer" }, { guild: "Night Watch", realm: "" }, {}]) {
    const response = await POST(form(bad as Record<string, string>));
    expect(where(response).searchParams.get("error")).toBe("invalid");
  }
  expect(mocks.suppressGuild).not.toHaveBeenCalled();
});

test("over the address limit, or with storage down, nothing is claimed", async () => {
  mocks.request.mockResolvedValueOnce({ allowed: false, retryAfter: 60 });
  expect(where(await POST(form({ guild: "Night Watch", realm: "Forever Pioneer" }))).searchParams.get("error")).toBe("limit");
  mocks.suppressGuild.mockRejectedValueOnce(new Error("down"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(where(await POST(form({ guild: "Night Watch", realm: "Forever Pioneer" }))).searchParams.get("error")).toBe("storage");
});
