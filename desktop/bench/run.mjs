// Bundles bench/bench.ts the way scripts/build.mjs bundles the app, with one change: the save file parser and the
// sent.json state are wrapped so the benchmark can count and time every call. The app's own code is not touched.
// Usage: npm run bench [-- --quick]
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = join(tmpdir(), `everloot-bench-${process.pid}.cjs`);

/** Renames `export function name(` to a private one and exports a timed wrapper under the old name. */
function wrap(source, names, wrapper) {
  let text = source;
  for (const name of names) {
    const from = `export function ${name}(`;
    if (!text.includes(from)) throw new Error(`bench: ${name} is no longer an exported function; update bench/run.mjs`);
    text = text.replace(from, `function __orig_${name}(`);
  }
  return `${text}\n${wrapper}\n`;
}

const probe = {
  name: "bench-probe",
  setup(b) {
    b.onLoad({ filter: /[\\/]web[\\/]src[\\/]lib[\\/]sv-parse\.ts$/ }, (args) => ({
      loader: "ts",
      contents: wrap(readFileSync(args.path, "utf8"), ["parseEverlootLua", "parseEverlootTable"], ["parseEverlootLua", "parseEverlootTable"].map((n) =>
        `export function ${n}(text: string) { const t = performance.now(); try { return __orig_${n}(text); } finally { (globalThis as any).__benchProbe?.("${n}", performance.now() - t); } }`).join("\n")),
    }));
    b.onLoad({ filter: /[\\/]companion[\\/]src[\\/]sent-state\.ts$/ }, (args) => ({
      loader: "ts",
      contents: wrap(readFileSync(args.path, "utf8"), ["createSentState"], `
export function createSentState(path: string, onRecovery?: (message: string) => void) {
  const t = performance.now();
  const s = __orig_createSentState(path, onRecovery);
  (globalThis as any).__benchProbe?.("sent.load", performance.now() - t);
  return { has: s.has, add(install: string, ids: string[]) { const t0 = performance.now(); try { s.add(install, ids); } finally { (globalThis as any).__benchProbe?.("sent.add", performance.now() - t0); } } };
}`),
    }));
  },
};

await build({
  bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], logLevel: "warning",
  alias: { zod: join(root, "..", "web", "node_modules", "zod") },
  entryPoints: [join(root, "bench", "bench.ts")], outfile, plugins: [probe],
});
try {
  const r = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], { stdio: "inherit" });
  process.exitCode = r.status ?? 1;
} finally {
  rmSync(outfile, { force: true });
}
