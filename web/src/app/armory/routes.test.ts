import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ hide: vi.fn(), enqueue: vi.fn(), quota: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/armory-store", () => ({ armoryStore: () => ({ hide: mocks.hide, enqueue: mocks.enqueue }) }));
vi.mock("@/lib/intake-quota", () => ({ intakeQuota: { form: mocks.quota } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { POST as hide } from "./hide/send/route";
import { POST as submit } from "./submit/send/route";

const form = (fields: Record<string, string>) => new Request("https://everloot.app/armory/x/send", {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields),
});
const where = (r: Response) => new URL(r.headers.get("location")!);
const good = { region: "eu", name: " Velkara ", surname: "Duskmantle" };

beforeEach(() => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  mocks.hide.mockReset().mockResolvedValue(undefined);
  mocks.enqueue.mockReset().mockResolvedValue(true);
  mocks.quota.mockReset().mockResolvedValue({ allowed: true, retryAfter: 0 });
  mocks.revalidatePath.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe.each([["hide", hide, "/armory/hide"], ["submit", submit, "/armory/submit"]] as const)("the %s form", (_name, POST, path) => {
  test("is a 404 with the switch off and writes nothing", async () => {
    vi.stubEnv("EVERLOOT_ARMORY", "");
    expect((await POST(form(good))).status).toBe(404);
    expect(mocks.hide).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  test("a body that is not a form is a 400; bad fields go back to the form with the error and nothing is written", async () => {
    const raw = await POST(new Request("https://everloot.app/x", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(raw.status).toBe(400);
    for (const fields of [{ ...good, region: "kr" }, { ...good, name: "V" }, { ...good, surname: "" }, { ...good, name: "Vel1" }, { ...good, surname: "Dusk-mantle" }, {}]) {
      const r = await POST(form(fields));
      expect(r.status).toBe(303);
      expect(where(r).pathname).toBe(path);
      expect(where(r).searchParams.get("error")).toBe("invalid");
    }
    expect(mocks.hide).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  test("the form limit applies, and a storage failure says so", async () => {
    mocks.quota.mockResolvedValue({ allowed: false, retryAfter: 60 });
    expect(where(await POST(form(good))).searchParams.get("error")).toBe("limit");
    mocks.quota.mockResolvedValue({ allowed: true, retryAfter: 0 });
    mocks.hide.mockRejectedValue(new Error("down"));
    mocks.enqueue.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = where(await POST(form(good)));
    expect(r.searchParams.get("error")).toBe("storage");
    expect(r.searchParams.get("name")).toBe("Velkara");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

test("a hide deletes by region and slug, clears the cached armory pages and confirms", async () => {
  const r = await hide(form(good));
  expect(r.status).toBe(303);
  expect(where(r).pathname + where(r).search).toBe("/armory/hide?done=1");
  expect(mocks.hide).toHaveBeenCalledWith("eu", "velkara-duskmantle");
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/armory", "layout");
});

test("a name with accents is accepted and its slug is composed and in lower case", async () => {
  await hide(form({ region: "eu", name: "E\u0301lodie", surname: "BRÚN" }));
  expect(mocks.hide).toHaveBeenCalledWith("eu", "élodie-brún");
  await submit(form({ region: "us", name: "Ølvir", surname: "Stål" }));
  expect(mocks.enqueue).toHaveBeenCalledWith("us", "character", "ølvir-stål", "website");
  await submit(form({ region: "eu", name: "E\u0301lodie", surname: "Bru\u0301n" }));
  expect(mocks.enqueue).toHaveBeenLastCalledWith("eu", "character", "élodie-brún", "website");
});

test("the server keeps 2 to 12 letters after composing: a decomposed 12 is accepted, a composed 13 is refused", async () => {
  await submit(form({ region: "eu", name: "A\u0301e\u0301i\u0301o\u0301u\u0301bcdefgh", surname: "Dusk" }));
  expect(mocks.enqueue).toHaveBeenLastCalledWith("eu", "character", "áéíóúbcdefgh-dusk", "website");
  for (const POST of [hide, submit]) {
    const r = await POST(form({ region: "eu", name: "Abcdefghijklm", surname: "Dusk" }));
    expect(where(r).searchParams.get("error")).toBe("invalid");
  }
  expect(mocks.hide).not.toHaveBeenCalled();
  expect(mocks.enqueue).toHaveBeenCalledTimes(1);
});

test("a combining mark with no composed letter passes the browser but not the server", async () => {
  const r = await hide(form({ region: "eu", name: "Saq\u0301ra", surname: "Dusk" }));
  expect(where(r).searchParams.get("error")).toBe("invalid");
  expect(mocks.hide).not.toHaveBeenCalled();
});

test("a submission queues the character from the website, and says when there was nothing to add", async () => {
  const r = await submit(form({ ...good, region: "us" }));
  expect(where(r).pathname + where(r).search).toBe("/armory/submit?done=1");
  expect(mocks.enqueue).toHaveBeenCalledWith("us", "character", "velkara-duskmantle", "website");
  mocks.enqueue.mockResolvedValue(false);
  expect(where(await submit(form(good))).search).toBe("?done=0");
});
