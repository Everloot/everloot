import { EventEmitter } from "node:events";
import { expect, test } from "vitest";
import { watchFile, type WatchFileDeps } from "../src/watch-file";

// A stand-in for fs.watch and the timers, so a test can deliver the events a real save produces in order.
function fakeHost(missing = false) {
  const watchers: Array<EventEmitter & { closed: boolean; fire: (event: string) => void; close: () => void }> = [];
  const timers: Array<{ run: () => void; ms: number; cancelled: boolean }> = [];
  const deps: WatchFileDeps = {
    watch: (_file, listener) => {
      if (missing) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      const w = Object.assign(new EventEmitter(), {
        closed: false,
        fire: (event: string) => listener(event),
        close: () => { w.closed = true; },
      });
      watchers.push(w);
      return w;
    },
    setTimeout: (run, ms) => { const t = { run, ms, cancelled: false }; timers.push(t); return t; },
    clearTimeout: (t) => { (t as { cancelled: boolean }).cancelled = true; },
  };
  const pending = () => timers.filter((t) => !t.cancelled);
  const runPending = () => { for (const t of pending()) { t.cancelled = true; t.run(); } };
  return { deps, watchers, pending, runPending, setMissing: (m: boolean) => { missing = m; } };
}

test("a change after the game moves the file aside and writes a new one is still seen", () => {
  const host = fakeHost();
  let changes = 0;
  watchFile("Everloot.lua", () => { changes += 1; }, host.deps);
  host.watchers[0].fire("rename");
  expect(changes).toBe(1);
  expect(host.watchers[0].closed).toBe(true);
  expect(host.pending().map((t) => t.ms)).toEqual([500]);
  host.runPending();
  expect(host.watchers).toHaveLength(2);
  host.watchers[1].fire("change");
  expect(changes).toBe(2);
});

test("a file that is not there yet is watched once it appears", () => {
  const host = fakeHost(true);
  let changes = 0;
  expect(() => watchFile("Everloot.lua", () => { changes += 1; }, host.deps)).not.toThrow();
  expect(host.pending().map((t) => t.ms)).toEqual([5000]);
  host.runPending();
  expect(host.pending().map((t) => t.ms)).toEqual([5000]);
  host.setMissing(false);
  host.runPending();
  host.watchers[0].fire("change");
  expect(changes).toBe(1);
});

test("an error from the watcher closes it and arms a new one instead of crashing", () => {
  const host = fakeHost();
  let changes = 0;
  watchFile("Everloot.lua", () => { changes += 1; }, host.deps);
  // EventEmitter throws on an "error" with no listener, which is the uncaught exception this guards against.
  expect(() => host.watchers[0].emit("error", new Error("EPERM"))).not.toThrow();
  expect(host.watchers[0].closed).toBe(true);
  expect(host.pending().map((t) => t.ms)).toEqual([5000]);
  host.runPending();
  host.watchers[1].fire("change");
  expect(changes).toBe(1);
});

test("a rename followed by an error on the same watcher arms only one new watcher", () => {
  const host = fakeHost();
  watchFile("Everloot.lua", () => {}, host.deps);
  host.watchers[0].fire("rename");
  host.watchers[0].emit("error", new Error("EPERM"));
  host.watchers[0].fire("change");
  expect(host.pending()).toHaveLength(1);
  host.runPending();
  expect(host.watchers).toHaveLength(2);
  // The old watcher's late error must not close the one now in use.
  host.watchers[0].emit("error", new Error("EPERM"));
  expect(host.watchers[1].closed).toBe(false);
  expect(host.pending()).toHaveLength(0);
});

test("stop cancels a pending re-arm, and late events from old watchers do not start a new one", () => {
  const host = fakeHost();
  let changes = 0;
  const stop = watchFile("Everloot.lua", () => { changes += 1; }, host.deps);
  host.watchers[0].fire("rename");
  stop();
  expect(host.pending()).toHaveLength(0);
  host.watchers[0].fire("rename");
  host.watchers[0].emit("error", new Error("EPERM"));
  expect(changes).toBe(1);
  expect(host.pending()).toHaveLength(0);
  expect(host.watchers).toHaveLength(1);
});

test("stop closes the live watcher, and its late events are ignored", () => {
  const host = fakeHost();
  let changes = 0;
  const stop = watchFile("Everloot.lua", () => { changes += 1; }, host.deps);
  stop();
  expect(host.watchers[0].closed).toBe(true);
  host.watchers[0].fire("change");
  expect(() => host.watchers[0].emit("error", new Error("EPERM"))).not.toThrow();
  expect(changes).toBe(0);
  expect(host.pending()).toHaveLength(0);
});
