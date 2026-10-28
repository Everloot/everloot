import { watch as fsWatch } from "node:fs";

/** What watchFile needs from the host; tests pass fakes, everything else gets fs.watch and the real timers. */
export interface WatchFileDeps {
  watch: (file: string, listener: (event: string) => void) => { close(): void; on(event: "error", listener: (err: Error) => void): unknown };
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
}

const host: WatchFileDeps = {
  watch: (file, listener) => fsWatch(file, listener),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

/** Calls onChange whenever the file is written, across the game's save-by-rename and a folder that comes and goes. Returns stop. */
export function watchFile(file: string, onChange: () => void, deps: WatchFileDeps = host): () => void {
  // fs.watch emits "error" when the folder vanishes (drive unplugged, WTF moved); with no listener
  // that is an uncaught exception. Close and try again every few seconds until stopped.
  let w: ReturnType<WatchFileDeps["watch"]> | null = null;
  let stopped = false;
  let retry: unknown = null;
  const rearm = (ms: number) => { w?.close(); w = null; if (retry) deps.clearTimeout(retry); retry = deps.setTimeout(arm, ms); };
  const arm = () => {
    retry = null;
    if (stopped) return;
    // The game saves by moving the old file aside and writing a new one. On Linux and macOS a watch
    // follows the moved file, so after a rename it is armed again on the new one. A watcher already
    // replaced or stopped can still deliver a late event; only the live one is listened to.
    let mine: ReturnType<WatchFileDeps["watch"]> | null = null;
    try {
      mine = deps.watch(file, (event) => {
        if (w !== mine) return;
        onChange();
        if (event === "rename") rearm(500);
      });
    } catch { retry = deps.setTimeout(arm, 5000); return; }
    w = mine;
    mine.on("error", () => { if (w === mine) rearm(5000); else mine?.close(); });
  };
  arm();
  return () => { stopped = true; if (retry) deps.clearTimeout(retry); w?.close(); w = null; };
}
