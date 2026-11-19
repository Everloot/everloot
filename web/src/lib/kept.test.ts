import { expect, test, vi } from "vitest";
import { keep } from "./kept";

const counter = () => {
  let n = 0;
  return vi.fn(async () => ({ value: ++n }));
};

test("a value is kept for ttlMs, then read again", async () => {
  const load = counter();
  const k = keep(load, { ttlMs: 1000 });
  expect(await k.get(undefined, 0)).toBe(1);
  expect(await k.get(undefined, 999)).toBe(1);
  expect(await k.get(undefined, 1000)).toBe(2);
  expect(load).toHaveBeenCalledTimes(2);
});

test("a read can keep its answer for less (a failed read is retried sooner) or for good", async () => {
  const answers = [{ value: null, keepMs: 60 }, { value: "file" }, { value: "file", keepMs: Infinity }];
  const k = keep<string | null>(async () => answers.shift()!, { ttlMs: 300 });
  expect(await k.get(undefined, 0)).toBeNull();
  expect(await k.get(undefined, 59)).toBeNull();
  expect(await k.get(undefined, 60)).toBe("file");
  expect(await k.get(undefined, 360)).toBe("file");
  expect(k.fresh(1e12)?.value).toBe("file");
});

test("the read is handed the last entry, fresh or not, and the caller's argument", async () => {
  const load = vi.fn(async (arg: string, last: { value: string } | null) => ({ value: `${arg}<-${last?.value ?? "none"}` }));
  const k = keep(load, { ttlMs: 10 });
  expect(await k.get("a", 0)).toBe("a<-none");
  expect(await k.get("b", 10)).toBe("b<-a<-none");
  expect(k.last()?.at).toBe(10);
});

test("callers that arrive during a read share it; with share off each reads on its own", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const load = vi.fn(async () => { await gate; return { value: load.mock.calls.length }; });
  const shared = keep(load, { ttlMs: 1000 });
  const both = Promise.all([shared.get(undefined, 0), shared.get(undefined, 0)]);
  release();
  expect(await both).toEqual([1, 1]);
  expect(load).toHaveBeenCalledTimes(1);

  const own = vi.fn(async () => ({ value: own.mock.calls.length }));
  const apart = keep(own, { ttlMs: 1000, share: false });
  await Promise.all([apart.get(undefined, 0), apart.get(undefined, 0)]);
  expect(own).toHaveBeenCalledTimes(2);
});

test("a read that throws keeps nothing, rethrows, and the next call reads again", async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce({ value: "up" });
  const k = keep<string>(load, { ttlMs: 1000 });
  await expect(k.get(undefined, 0)).rejects.toThrow("down");
  expect(k.last()).toBeNull();
  expect(await k.get(undefined, 1)).toBe("up");
});

test("stale-while-refresh answers with the expired value and reads again behind it", async () => {
  const load = counter();
  const k = keep(load, { ttlMs: 10, staleWhileRefresh: true });
  expect(await k.get(undefined, 0)).toBe(1);
  expect(await k.get(undefined, 20)).toBe(1);
  await vi.waitFor(() => expect(k.fresh(21)?.value).toBe(2));
  expect(load).toHaveBeenCalledTimes(2);
});

test("forget drops the entry", async () => {
  const load = counter();
  const k = keep(load, { ttlMs: 1000 });
  await k.get(undefined, 0);
  k.forget();
  expect(k.last()).toBeNull();
  expect(await k.get(undefined, 1)).toBe(2);
});
