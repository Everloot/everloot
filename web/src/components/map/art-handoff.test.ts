import { expect, test, vi } from "vitest";
import { artHandoff } from "./art-handoff";

test("keeps ready artwork until its replacement loads and discards stale loads", async () => {
  vi.useFakeTimers();
  const loaded = new Map<string, () => void>();
  const shown: string[] = [], removed: string[] = [];
  const handoff = artHandoff((key: string) => ({ layer: key, ready: new Promise<void>((resolve) => loaded.set(key, resolve)) }),
    (key) => shown.push(key), (key) => removed.push(key), 180);
  handoff.set("a"); loaded.get("a")!(); await Promise.resolve();
  handoff.set("b");
  expect(removed).toEqual([]);
  handoff.set("c");
  expect(removed).toEqual(["b"]);
  loaded.get("b")!(); await Promise.resolve();
  expect(shown).toEqual(["a"]);
  loaded.get("c")!(); await Promise.resolve();
  expect(shown).toEqual(["a", "c"]);
  expect(removed).toEqual(["b"]);
  vi.advanceTimersByTime(180);
  expect(removed).toEqual(["b", "a"]);
  handoff.set(null);
  expect(removed).toEqual(["b", "a", "c"]);
  vi.useRealTimers();
});

test("clearing the layer prevents a late load from displaying artwork", async () => {
  let ready!: () => void;
  const show = vi.fn(), remove = vi.fn();
  const handoff = artHandoff((key: string) => ({ layer: key, ready: new Promise<void>((resolve) => { ready = resolve; }) }), show, remove, 0);
  handoff.set("a"); handoff.set(null); ready(); await Promise.resolve();
  expect(show).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledExactlyOnceWith("a");
});

test("a failed replacement keeps the current image and retries only after leaving that target", async () => {
  const jobs = new Map<string, { resolve: () => void; reject: () => void }>();
  const load = vi.fn((key: string) => ({ layer: key, ready: new Promise<void>((resolve, reject) => jobs.set(key, { resolve, reject })) }));
  const show = vi.fn(), remove = vi.fn();
  const handoff = artHandoff(load, show, remove, 0);
  handoff.set("a"); jobs.get("a")!.resolve(); await Promise.resolve();
  handoff.set("b"); jobs.get("b")!.reject(); await Promise.resolve();
  handoff.set("b");
  expect(load).toHaveBeenCalledTimes(2);
  expect(remove).toHaveBeenCalledExactlyOnceWith("b");
  expect(show).toHaveBeenCalledExactlyOnceWith("a", null);
  handoff.set("a"); handoff.set("b");
  expect(load).toHaveBeenCalledTimes(3);
  handoff.set(null);
});
