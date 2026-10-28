import type { EngineState, Job, JobStatus, LogLine, Settings } from "../shared/types";
import { JOBS } from "../shared/types";

/** The work the engine schedules. Injected so tests run it with no files and no network. */
export interface EngineDeps {
  findFiles(gameFolder: string): string[];
  /**
   * Uploads one account file; the returned line goes to the log. A rejection with a `retryAfterMs` field is the site's
   * 429 (the uploader's `RateLimited`): its wait in ms, or null when the site gave none the uploader could use.
   */
  upload(file: string): Promise<string>;
  prices(files: string[]): Promise<string>;
  ask(file: string): Promise<string>;
  /** Starts watching a file and returns the function that stops it. */
  watch(file: string, onChange: () => void): () => void;
  now?(): Date;
}

export interface EngineOptions {
  /** The game writes SavedVariables at logout or /reload; wait for the write to settle. */
  uploadSettleMs?: number;
  askSettleMs?: number;
  pricesEveryMs?: number;
  /** How often the game folder is searched again for account files that appeared after start. */
  rescanMs?: number;
  /** The waits before each retry of a failed upload or /ask run; after the last, the next write tries again. */
  retryMs?: number[];
  logLines?: number;
}

export interface Engine {
  start(settings: Settings): void;
  stop(): void;
  /** Upload now and friends: a failure here gets the full round of retries again, a 429's wait still first. */
  runNow(job: Job): Promise<void>;
  /** The system woke, and the network usually with it: a job that ran out of retries gets one more round. */
  recover(): void;
  setPaused(paused: boolean): void;
  snapshot(): EngineState;
  /** A line on the Log page from outside the jobs (the app's own errors). */
  log(level: LogLine["level"], text: string): void;
  onChange(listener: (state: EngineState) => void): () => void;
}

/** "ACCOUNT" from ".../WTF/Account/ACCOUNT/SavedVariables/Everloot.lua", for log lines; the full path otherwise. */
export const accountOf = (file: string): string => {
  const parts = file.split(/[\\/]/);
  const i = parts.lastIndexOf("SavedVariables");
  return i > 0 ? parts[i - 1] : file;
};

const enabled = (s: Settings, job: Job) => (job === "upload" ? s.upload : job === "prices" ? s.prices : s.ask.enabled);

/** setTimeout runs a longer delay at once. A longer wait comes back to the check in `run` and is set again. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** A rate limit's wait: a positive finite number of ms, or null; undefined when `err` is no rate limit. */
const rateLimitWait = (err: unknown): number | null | undefined => {
  if (!err || typeof err !== "object" || !("retryAfterMs" in err)) return undefined;
  const ms = err.retryAfterMs;
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? ms : null;
};

export function createEngine(deps: EngineDeps, options: EngineOptions = {}): Engine {
  const settle: Record<Job, number> = { upload: options.uploadSettleMs ?? 5000, ask: options.askSettleMs ?? 2000, prices: 0 };
  const pricesEvery = options.pricesEveryMs ?? 60 * 60 * 1000;
  const rescanEvery = options.rescanMs ?? 30_000;
  const retryAfter = options.retryMs ?? [60_000, 5 * 60_000, 15 * 60_000];
  const maxLog = options.logLines ?? 200;
  const now = () => (deps.now ? deps.now() : new Date()).toISOString();
  const clock = () => (deps.now ? deps.now() : new Date()).getTime();

  const off = (): JobStatus => ({ state: "off", message: "", at: null });
  const state: EngineState = { files: [], jobs: { upload: off(), prices: off(), ask: off() }, log: [], paused: false };
  const listeners = new Set<(s: EngineState) => void>();
  let settings: Settings | null = null;
  let session = 0;
  let unwatchers: (() => void)[] = [];
  const timers = new Map<Job, ReturnType<typeof setTimeout>>();
  let pricesTimer: ReturnType<typeof setInterval> | null = null;
  let rescanTimer: ReturnType<typeof setInterval> | null = null;
  /** Retries already spent per job since its last success. */
  const retries = new Map<Job, number>();
  const running = new Set<Job>();
  const again = new Set<Job>();
  const renew = new Set<Job>();
  /**
   * Per job, the time a site's 429 asked us to wait until. No run of the job starts before it for that site, Upload
   * now included: the run is set for then instead. It outlives stop() and start(), so a restart cannot skip it.
   */
  const waits = new Map<string, number>();
  const waitKey = (job: Job, endpoint: string) => {
    try { return `${job}:${new URL(endpoint).origin}`; }
    catch { return `${job}:${endpoint}`; } // Invalid settings still reach the job's normal error handling.
  };
  const waitLine = (job: Job, ms: number) => `${job}: the site asked to wait; trying again in ${Math.max(1, Math.round(ms / 60_000))} min`;

  const snapshot = (): EngineState => ({ files: [...state.files], jobs: { upload: { ...state.jobs.upload }, prices: { ...state.jobs.prices }, ask: { ...state.jobs.ask } }, log: [...state.log], paused: state.paused });
  const emit = () => { const s = snapshot(); for (const l of listeners) l(s); };
  const log = (level: LogLine["level"], text: string) => {
    state.log.push({ at: now(), level, text });
    if (state.log.length > maxLog) state.log.splice(0, state.log.length - maxLog);
  };
  const set = (job: Job, patch: Partial<JobStatus>) => { state.jobs[job] = { ...state.jobs[job], ...patch }; };

  /** `fresh` starts the job's retries over, as a run the user asked for does. */
  async function run(job: Job, fresh = false): Promise<void> {
    const s = settings;
    if (!s || !enabled(s, job)) return;
    if (state.paused) { log("info", `${job}: paused, skipped`); emit(); return; }
    if (fresh && !running.has(job)) retries.delete(job);
    const key = waitKey(job, s.endpoint);
    const left = (waits.get(key) ?? 0) - clock();
    if (left > 0) { log("info", waitLine(job, left)); schedule(job, left); emit(); return; }
    waits.delete(key);
    if (running.has(job)) { again.add(job); if (fresh) renew.add(job); return; }
    if (state.files.length === 0) { set(job, { state: "idle", message: "No Everloot.lua to read", at: now() }); emit(); return; }
    const started = session;
    const files = [...state.files];
    running.add(job);
    set(job, { state: "running", message: "", at: now() });
    emit();
    const failures: string[] = [];
    const lines: string[] = [];
    // A 429 holds the account files after it too: they go to the same site.
    let limited = undefined as { ms: number | null } | undefined;
    const attempt = async (label: string, work: () => Promise<string>) => {
      if (started !== session) return;
      try { const line = await work(); if (started !== session) return; lines.push(line); log("info", `${label}: ${line}`); }
      catch (err) {
        const ms = rateLimitWait(err);
        if (ms !== undefined) limited = { ms };
        if (started !== session) return;
        const m = err instanceof Error ? err.message : String(err); failures.push(m); log("error", `${label}: ${m}`);
      }
    };
    if (job === "upload") for (const file of files) { if (limited) break; await attempt(`upload ${accountOf(file)}`, () => deps.upload(file)); }
    else if (job === "ask") for (const file of files) await attempt(`ask ${accountOf(file)}`, () => deps.ask(file));
    else await attempt("prices", () => deps.prices(files));
    running.delete(job);
    if (started !== session) {
      // The old request's wait still applies to its site, without updating the new session's job status.
      if (limited) waits.set(waitKey(job, s.endpoint), clock() + (limited.ms ?? retryAfter[0] ?? 0));
      if (again.delete(job)) void run(job, renew.delete(job));
      return;
    }
    set(job, failures.length
      ? { state: "error", message: failures[failures.length - 1], at: now() }
      : { state: "ok", message: lines[lines.length - 1] ?? "", at: now() });
    // Usually the network or the site; try again a few times instead of waiting for the next logout.
    // Prices have their own hourly timer. A run after stop() belongs to an old session: no retry.
    if (failures.length === 0) retries.delete(job);
    else if (job !== "prices" && settings === s) {
      const n = retries.get(job) ?? 0;
      // A 429 waits the site's own time, or the usual retry's when it gave none; the retry is queued and the check in
      // `run` sets it for then. Past the last retry the wait still holds, and the next write after it tries again.
      if (limited) waits.set(waitKey(job, s.endpoint), clock() + (limited.ms ?? retryAfter[Math.min(n, retryAfter.length - 1)] ?? 0));
      if (n < retryAfter.length) {
        retries.set(job, n + 1);
        if (limited) again.add(job);
        else {
          log("info", `${job}: trying again in ${Math.round(retryAfter[n] / 60_000)} min`);
          schedule(job, retryAfter[n]);
        }
      }
    }
    emit();
    // Prices follow every upload, as `watch --game` does on the command line.
    if (job === "upload" && failures.length === 0 && s.prices) void run("prices");
    if (again.delete(job)) void run(job, renew.delete(job));
  }

  function schedule(job: Job, delay = settle[job]): void {
    const t = timers.get(job);
    if (t) clearTimeout(t);
    timers.set(job, setTimeout(() => { timers.delete(job); void run(job); }, Math.min(delay, MAX_TIMER_MS)));
  }

  /** An account file written after start (the first logout, a second account) restarts the engine with it. */
  function rescan(s: Settings): void {
    let found: string[];
    try { found = deps.findFiles(s.gameFolder!); } catch { return; }
    const fresh = found.filter((f) => !state.files.includes(f));
    if (!fresh.length) return;
    log("info", `Found ${fresh.length} new account file(s)`);
    start(s);
  }

  function stop(): void {
    session++;
    for (const u of unwatchers) u();
    unwatchers = [];
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    if (pricesTimer) { clearInterval(pricesTimer); pricesTimer = null; }
    if (rescanTimer) { clearInterval(rescanTimer); rescanTimer = null; }
    retries.clear();
    again.clear();
    renew.clear();
    settings = null;
    state.files = [];
    for (const job of JOBS) state.jobs[job] = off();
    emit();
  }

  function start(s: Settings): void {
    stop();
    settings = s;
    for (const job of JOBS) state.jobs[job] = enabled(s, job) ? { state: "idle", message: "", at: null } : off();
    if (!s.consentedAt) { log("info", "Waiting for setup to finish"); emit(); return; }
    if (!s.gameFolder) { log("info", "No game folder set"); emit(); return; }
    state.files = deps.findFiles(s.gameFolder);
    rescanTimer = setInterval(() => rescan(s), rescanEvery);
    if (state.files.length === 0) {
      log("info", `No Everloot.lua under ${s.gameFolder}. Log out once so the game writes it.`);
      emit();
      return;
    }
    log("info", `Watching ${state.files.length} account file(s) in ${s.gameFolder}`);
    for (const file of state.files) {
      unwatchers.push(deps.watch(file, () => {
        if (s.upload) schedule("upload");
        if (s.ask.enabled) schedule("ask");
      }));
    }
    if (s.prices) pricesTimer = setInterval(() => void run("prices"), pricesEvery);
    emit();
    if (s.upload) void run("upload"); else if (s.prices) void run("prices");
    if (s.ask.enabled) void run("ask");
  }

  return {
    start,
    stop,
    runNow: (job) => run(job, true),
    recover: () => {
      // Only a job whose last round failed to the end and has nothing set: a second wake mid-round, a running job or
      // a write already waiting to settle is left as it is. Prices have their hourly timer.
      for (const job of JOBS) {
        if (job === "prices" || state.jobs[job].state !== "error" || timers.has(job)) continue;
        if ((retries.get(job) ?? 0) < retryAfter.length) continue;
        void run(job, true);
      }
    },
    setPaused: (paused) => {
      const resumed = state.paused && !paused;
      state.paused = paused;
      log("info", paused ? "Paused" : "Resumed");
      emit();
      // A logout while paused was skipped; catch up on it now. Upload brings prices along.
      if (!resumed || !settings) return;
      if (settings.upload) void run("upload"); else if (settings.prices) void run("prices");
      if (settings.ask.enabled) void run("ask");
    },
    snapshot,
    log: (level, text) => { log(level, text); emit(); },
    onChange: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
