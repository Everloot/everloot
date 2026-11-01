/**
 * Measures the Desktop App's main-thread work around the save file and sent.json (audit items F11, F12, F24).
 * Run with `npm run bench` (bench/run.mjs bundles this file with call counters around the parser and sent.json state).
 * Everything here is synthetic and lives in a temp folder; nothing is sent anywhere.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { readAsks } from "../../companion/src/bridge/asks";
import { readRealms } from "../../companion/src/prices";
import { createSentState } from "../../companion/src/sent-state";
import { parseEverlootLua, parseEverlootTable } from "../../web/src/lib/sv-parse";
import { charactersFromFiles, summarizeCharacters } from "../src/main/characters";
import { createEngine } from "../src/main/engine";
import { confirmedCounts, readScanAges, staleScans, summarizeFiles } from "../src/main/inspect";
import { companionJobs } from "../src/main/jobs";
import { ownRealms } from "../src/main/market";
import { defaultSettings } from "../src/main/settings";
import type { Settings } from "../src/shared/types";
import { SCENARIOS, syntheticSave, syntheticSent } from "./synthetic";

type Probe = (name: string, ms: number) => void;
const g = globalThis as typeof globalThis & { __benchProbe?: Probe };
const quick = process.argv.includes("--quick");

// ---------- helpers ----------
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const ms = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2));
const mb = (bytes: number) => `${(bytes / 1e6).toFixed(2)} MB`;
function time(runs: number, warm: number, fn: () => void): { p50: number; p95: number } {
  for (let i = 0; i < warm; i++) fn();
  const xs: number[] = [];
  for (let i = 0; i < runs; i++) { const t = performance.now(); fn(); xs.push(performance.now() - t); }
  return { p50: pct(xs, 50), p95: pct(xs, 95) };
}
const table = (head: string[], rows: (string | number)[][]) =>
  [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const runsFor = (name: string) => (quick ? 3 : name === "small" ? 30 : name === "heavy" ? 15 : 5);

/** Records every instrumented call (parser and sent.json) made while `fn` runs. */
async function recording<T>(fn: () => Promise<T>): Promise<{ value: T; calls: { name: string; ms: number; via: string }[] }> {
  const calls: { name: string; ms: number; via: string }[] = [];
  g.__benchProbe = (name, ms) => {
    // The first frame outside the parser and the probe names the call site.
    const frames = (new Error().stack ?? "").split("\n").slice(1).map((l) => l.trim());
    const site = frames.find((f) => !/__benchProbe|__orig_|parseEverloot(Lua|Table)|createSentState|Object\.add|at add /.test(f)) ?? "?";
    calls.push({ name, ms, via: (/at (?:Object\.)?([\w.$<>]+)/.exec(site)?.[1] ?? site).replace(/^Object\./, "") });
  };
  try { return { value: await fn(), calls }; } finally { g.__benchProbe = undefined; }
}

// ---------- the app's cycle, with its real engine and jobs ----------
/** The site's answers, instant: a receipt that accepts every row, empty prices, no drop rates, no settled list. */
let intakeRequests = 0;
const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (url.pathname === "/api/intake") {
    intakeRequests++;
    const rows = (JSON.parse(String(init?.body)) as { records: { kind: string }[] }).records;
    return json({ ok: true, persisted: true, uploadId: `bench-${intakeRequests}`, accepted: rows.map((r, index) => ({ index, kind: r.kind })) });
  }
  if (url.pathname === "/api/market/prices") return json({ ok: true, realm: url.searchParams.get("realm"), dataAsOf: "2026-10-31", items: [] });
  if (url.pathname === "/api/rollups/drops") return json({ unreachable: false, rates: [] });
  return new Response("not found", { status: 404 });
};

interface CycleResult { parses: number; parseMs: number; maxParse: number; byCaller: Map<string, number>; sentWrites: number; sentWriteMs: number; emits: number; batches: number; loopMax: number }

/**
 * One account's logout as the app handles it: the upload job (prices follow it) and the ask job, with every state push
 * doing what index.ts's broadcast does for the scan ages (memoized per size and write time, as there).
 */
async function cycles(scenario: (typeof SCENARIOS)[number], steadyRuns: number): Promise<{ first: CycleResult; steady: CycleResult[]; sentBytes: number }> {
  const root = mkdtempSync(join(tmpdir(), "everloot-bench-"));
  try {
    const game = join(root, "game"), data = join(root, "data");
    const sv = join(game, "WTF", "Account", "BENCH", "SavedVariables");
    mkdirSync(sv, { recursive: true });
    const file = join(sv, "Everloot.lua");
    writeFileSync(file, syntheticSave(scenario));
    const settings: Settings = { ...defaultSettings(), gameFolder: game, endpoint: "https://bench.example", consentedAt: "2026-11-01T00:00:00Z", ask: { ...defaultSettings().ask, enabled: true } };
    g.fetch = fakeFetch;
    const jobs = companionJobs(data, () => settings);
    // The app's own settle times: a write is picked up by the real file watcher, as after a logout.
    const engine = createEngine(jobs.deps, { rescanMs: 1e9, pricesEveryMs: 1e9 });
    let emits = 0;
    // index.ts: `allScans` behind every broadcast, remembered per file size and write time.
    const scanMemo = new Map<string, { key: string; scans: ReturnType<typeof readScanAges> }>();
    engine.onChange((s) => {
      emits++;
      staleScans(s.files.flatMap((f) => {
        const st = statSync(f), key = `${st.mtimeMs}:${st.size}`;
        const hit = scanMemo.get(f);
        if (hit && hit.key === key) return hit.scans;
        const scans = readScanAges(readFileSync(f, "utf8"));
        scanMemo.set(f, { key, scans });
        return scans;
      }));
    });
    const settled = (before: (string | null)[]) => new Promise<void>((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        const j = engine.snapshot().jobs;
        const all = [j.upload, j.prices, j.ask];
        if (all.every((x, i) => x.at !== null && x.at !== before[i] && (x.state === "ok" || x.state === "error"))) {
          const failed = all.find((x) => x.state === "error");
          return failed ? reject(new Error(`a job failed: ${failed.message}`)) : resolve();
        }
        if (Date.now() - t0 > 300_000) return reject(new Error("cycle did not settle"));
        setTimeout(tick, 2);
      };
      tick();
    });
    const measure = async (start: () => void): Promise<CycleResult> => {
      const j = engine.snapshot().jobs;
      const before = [j.upload.at, j.prices.at, j.ask.at];
      emits = 0; intakeRequests = 0;
      // The longest gap between ticks of a 1 ms timer: how long the thread could not answer anything else.
      let last = performance.now(), loopMax = 0;
      const ticker = setInterval(() => { const now = performance.now(); loopMax = Math.max(loopMax, now - last); last = now; }, 1);
      const { calls } = await recording(async () => { start(); await settled(before); });
      clearInterval(ticker);
      loopMax = Math.max(loopMax, performance.now() - last);
      const parses = calls.filter((c) => c.name.startsWith("parse"));
      const writes = calls.filter((c) => c.name === "sent.add");
      const byCaller = new Map<string, number>();
      for (const c of parses) byCaller.set(c.via, (byCaller.get(c.via) ?? 0) + 1);
      return {
        parses: parses.length, parseMs: parses.reduce((n, c) => n + c.ms, 0), maxParse: Math.max(0, ...parses.map((c) => c.ms)), byCaller,
        sentWrites: writes.length, sentWriteMs: writes.reduce((n, c) => n + c.ms, 0), emits, batches: intakeRequests, loopMax,
      };
    };
    // The first run sends the whole file: every row is new.
    const first = await measure(() => engine.start(settings));
    const steady: CycleResult[] = [];
    for (let i = 1; i <= steadyRuns; i++) {
      // The next logout: 20 more rows, a new size and write time. The watcher starts the jobs.
      const text = syntheticSave(scenario, 20 * i);
      writeFileSync(file, text);
      steady.push(await measure(() => {}));
    }
    engine.stop();
    return { first, steady, sentBytes: statSync(join(data, "sent.json")).size };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------- report ----------
async function main(): Promise<void> {
  const out: string[] = [];
  const say = (s = "") => { out.push(s); console.log(s); };
  say(`Machine: ${cpus().length} logical cores, ${Math.round(totalmem() / 2 ** 30)} GB, Node ${process.versions.node} (${process.platform}). CPU: ${cpus()[0]?.model.trim()}.`);
  say(quick ? "Quick mode: 3 runs each; use the full run for the report." : "");

  const texts = SCENARIOS.map((s) => ({ s, text: syntheticSave(s) }));
  say("\n### Save files and one parse (ms, p50 / p95)\n");
  const rows: (string | number)[][] = [];
  for (const { s, text } of texts) {
    const runs = runsFor(s.name), warm = s.name === "extreme" ? 1 : 2;
    const recs = parseEverlootLua(text).records.length;
    const cell = (fn: () => void) => { const r = time(runs, warm, fn); return `${ms(r.p50)} / ${ms(r.p95)}`; };
    const root = mkdtempSync(join(tmpdir(), "everloot-bench-"));
    const f = join(root, "Everloot.lua");
    writeFileSync(f, text);
    rows.push([
      s.name, mb(Buffer.byteLength(text)), recs.toLocaleString("en-US"),
      cell(() => parseEverlootLua(text)), cell(() => parseEverlootTable(text)), cell(() => readRealms(text)), cell(() => readAsks(text)),
      cell(() => readScanAges(text)), cell(() => summarizeCharacters(text)), cell(() => ownRealms([f])),
      cell(() => charactersFromFiles([f])),
    ]);
    rmSync(root, { recursive: true, force: true });
  }
  say(table(["size", "file", "records", "parseEverlootLua (upload job)", "parseEverlootTable", "readRealms (prices job)", "readAsks (ask job)", "readScanAges (broadcast)", "summarizeCharacters", "ownRealms, read + parse (Overview / Market page)", "charactersFromFiles (Characters page)"], rows));

  say("\n### One logout, as the engine runs it (upload, then prices; ask beside it)\n");
  say("First run = every row is new (an install's first upload), started as at launch. Steady = the next logouts, 20 new rows each, started by the real file watcher after the app's settle times; p50 / p95 across runs. The site is a local stub that answers at once.\n");
  const crow: (string | number)[][] = [];
  let callers = "";
  for (const s of SCENARIOS) {
    const steadyRuns = quick ? 2 : s.name === "extreme" ? 3 : 8;
    const r = await cycles(s, steadyRuns);
    const st = r.steady;
    const pp = (f: (c: CycleResult) => number) => `${ms(pct(st.map(f), 50))} / ${ms(pct(st.map(f), 95))}`;
    const range = (f: (c: CycleResult) => number) => { const xs = st.map(f); const lo = Math.min(...xs), hi = Math.max(...xs); return lo === hi ? String(lo) : `${lo}-${hi}`; };
    crow.push([s.name, "first", r.first.parses, ms(r.first.parseMs), ms(r.first.maxParse), r.first.batches, r.first.sentWrites, ms(r.first.sentWriteMs), r.first.emits, ms(r.first.loopMax)]);
    crow.push([s.name, "steady", range((c) => c.parses), pp((c) => c.parseMs), pp((c) => c.maxParse), range((c) => c.batches), range((c) => c.sentWrites), pp((c) => c.sentWriteMs), range((c) => c.emits), pp((c) => c.loopMax)]);
    if (s.name === "heavy") callers = [...st[0].byCaller].map(([k, n]) => `${k} x${n}`).join(", ");
    say(`- ${s.name}: sent.json after the first run ${mb(r.sentBytes)}`);
  }
  say("");
  say(table(["size", "run", "full parses", "parse ms total", "longest parse", "batches", "sent.json writes", "sent.json write ms", "state pushes", "longest event-loop stall"], crow));
  say(`\nParse calls in one steady heavy cycle, by caller: ${callers}.`);

  say("\n### sent.json (one install's receipts; ms, p50 / p95)\n");
  const srow: (string | number)[][] = [];
  for (const n of [10_000, 100_000, 1_000_000]) {
    const root = mkdtempSync(join(tmpdir(), "everloot-bench-"));
    const path = join(root, "sent.json");
    const text = syntheticSent(n);
    writeFileSync(path, text);
    const runs = quick ? 3 : n >= 1_000_000 ? 5 : n >= 100_000 ? 10 : 20;
    const load = time(runs, 1, () => createSentState(path));
    const state = createSentState(path);
    let k = 0;
    const save = time(runs, 1, () => state.add("a1b2-c3d4-e5f6-0718", Array.from({ length: 100 }, () => `new:${++k}`)));
    const counts = time(runs, 1, () => confirmedCounts(path)("x"));
    srow.push([n.toLocaleString("en-US"), mb(statSync(path).size), `${ms(load.p50)} / ${ms(load.p95)}`, `${ms(save.p50)} / ${ms(save.p95)}`, `${ms(counts.p50)} / ${ms(counts.p95)}`]);
    rmSync(root, { recursive: true, force: true });
  }
  say(table(["event ids", "file", "load at launch (createSentState)", "save after one batch (add, 100 ids)", "Upload page read (confirmedCounts)"], srow));

  // summarizeFiles is the Upload page: memoized per write, but it reads sent.json again on every call.
  say("\n### Upload page (summarizeFiles, heavy save; ms, p50 / p95)\n");
  {
    const root = mkdtempSync(join(tmpdir(), "everloot-bench-"));
    const f = join(root, "Everloot.lua");
    writeFileSync(f, texts[1].text);
    const urow: (string | number)[][] = [];
    for (const n of [10_000, 100_000, 1_000_000]) {
      const sentPath = join(root, `sent-${n}.json`);
      writeFileSync(sentPath, syntheticSent(n));
      summarizeFiles([f], sentPath, "https://everloot.app");
      const hit = time(quick ? 3 : 10, 1, () => summarizeFiles([f], sentPath, "https://everloot.app"));
      urow.push([n.toLocaleString("en-US"), `${ms(hit.p50)} / ${ms(hit.p95)}`]);
    }
    const missRuns: number[] = [];
    for (let i = 0; i < (quick ? 2 : 5); i++) {
      writeFileSync(f, syntheticSave(SCENARIOS[1], i + 1));
      const t = performance.now(); summarizeFiles([f], join(root, "sent-10000.json"), "https://everloot.app"); missRuns.push(performance.now() - t);
    }
    say(`After a write (cache miss: parseEverlootLua + three parseEverlootTable): ${ms(pct(missRuns, 50))} / ${ms(pct(missRuns, 95))} ms.\n`);
    say(table(["sent.json event ids", "a later open or state push (cache hit, sent.json read again)"], urow));
    rmSync(root, { recursive: true, force: true });
  }
}

void main().catch((err) => { console.error(err); process.exit(1); });
