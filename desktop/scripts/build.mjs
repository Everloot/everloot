// Bundles the Node side, the preload and the page into dist/. The companion's modules and the
// site's parser are bundled in, so the packaged app ships dist/ and nothing from node_modules.
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const watch = process.argv.includes("--watch");

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "renderer"), { recursive: true });

const node = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
  // `zod` is only installed under web/; the companion resolves it the same way.
  alias: { zod: join(root, "..", "web", "node_modules", "zod") },
};

await Promise.all([
  build({ ...node, entryPoints: [join(root, "src/main/index.ts")], outfile: join(dist, "main.cjs") }),
  build({ ...node, entryPoints: [join(root, "src/preload.ts")], outfile: join(dist, "preload.cjs") }),
  // The save reader's worker thread; the main process reads this file's text and starts it with eval (see save-reader.ts).
  build({ ...node, entryPoints: [join(root, "src/main/parse-worker.ts")], outfile: join(dist, "parse-worker.cjs") }),
  build({
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome130",
    sourcemap: true,
    logLevel: "info",
    entryPoints: [join(root, "src/renderer/app.ts")],
    outfile: join(dist, "renderer", "app.js"),
  }),
]);
cpSync(join(root, "src/renderer/index.html"), join(dist, "renderer", "index.html"));
cpSync(join(root, "src/renderer/styles.css"), join(dist, "renderer", "styles.css"));
// The page's fonts come from the geist package under web/ (SIL OFL 1.1), the same files the site serves.
const geist = join(root, "..", "web", "node_modules", "geist", "dist", "fonts");
mkdirSync(join(dist, "renderer", "fonts"), { recursive: true });
for (const [dir, file] of [["geist-sans", "Geist-Variable.woff2"], ["geist-mono", "GeistMono-Variable.woff2"]]) {
  const from = join(geist, dir, file);
  if (!existsSync(from)) throw new Error(`${from} is missing: run npm ci in web/ first, the desktop bundle takes its fonts from there`);
  cpSync(from, join(dist, "renderer", "fonts", file));
}
cpSync(join(root, "build", "icon.png"), join(dist, "renderer", "logo.png"));
// Tray icons travel with the bundle; build/ itself is only for electron-builder.
for (const icon of ["tray.png", "trayTemplate.png", "trayTemplate@2x.png"]) cpSync(join(root, "build", icon), join(dist, icon));
if (watch) console.log("--watch is not supported; run the build again after a change.");
