// Keep the version badge independent of the large game-file layer. Regenerated before each site build.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export function writeBuildVersion(source, output) {
  const { build: { product, version } } = JSON.parse(readFileSync(source, "utf8"));
  if (typeof product !== "string" || !product || typeof version !== "string" || !version) throw new Error("Missing game build stamp");
  writeFileSync(output, `${JSON.stringify({ product, version })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeBuildVersion(
    process.argv[2] ?? fileURLToPath(new URL("../src/data/game-data/client-layer.json", import.meta.url)),
    process.argv[3] ?? fileURLToPath(new URL("../src/data/game-data/build-version.json", import.meta.url)),
  );
}
