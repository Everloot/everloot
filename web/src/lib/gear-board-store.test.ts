import { expect, test, vi } from "vitest";
import { deleteGearBoard, GEAR_BOARD_KEY } from "./gear-board-store";

const r2 = { r2AccountId: "acct", r2AccessKeyId: "id", r2SecretAccessKey: "not-a-real-value", r2Bucket: "bucket" };

test("deletes the stored gear boards; an absent file counts as deleted", async () => {
  for (const status of [204, 404]) {
    const fetch = vi.fn(async (_req: Request) => new Response(null, { status }));
    expect(await deleteGearBoard({ r2, fetch: fetch as unknown as typeof globalThis.fetch })).toBe(true);
    const req = fetch.mock.calls[0]![0];
    expect(req.method).toBe("DELETE");
    expect(req.url).toBe(`https://acct.r2.cloudflarestorage.com/bucket/${GEAR_BOARD_KEY}`);
  }
});

test("without the cloud store nothing is sent; a storage error throws", async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 500 }));
  expect(await deleteGearBoard({ r2: null, fetch })).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  await expect(deleteGearBoard({ r2, fetch })).rejects.toThrow("gear board delete failed (500)");
});
