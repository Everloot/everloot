import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { pillowConverter } from "../src/client-assets.js";

// The real converter (scripts/blp_convert.py), with BLP tiles Pillow writes itself. Skipped without Python and Pillow.
const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
const hasPillow = spawnSync(python, ["-E", "-c", "import PIL"], { stdio: "ignore" }).status === 0;

function py(code: string, ...args: string[]): string {
  const r = spawnSync(python, ["-E", "-c", code, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

test.skipIf(!hasPillow)("the converter draws a zone's overlays over its base tiles, each edge tile cut to the overlay", async () => {
  const dir = mkdtempSync(join(tmpdir(), "everloot-blp-"));
  // Two red 4 x 4 base tiles, and a blue 4 x 4 overlay tile of which only 3 x 2 belongs to the overlay.
  py(`
import sys
from PIL import Image
d = sys.argv[1]
for name, colour in (("base0", (255, 0, 0)), ("base1", (255, 0, 0)), ("blue", (0, 0, 255))):
    Image.new("RGB", (4, 4), colour).convert("P").save(f"{d}/{name}.blp")
`, dir);
  const dst = join(dir, "map.webp");
  const [result] = await pillowConverter([{
    dst, tile: [4, 4], crop: [0, 0, 8, 4],
    tiles: [{ src: join(dir, "base0.blp"), row: 0, col: 0 }, { src: join(dir, "base1.blp"), row: 0, col: 1 }],
    overlays: [{ x: 2, y: 1, width: 3, height: 2, tiles: [{ src: join(dir, "blue.blp"), row: 0, col: 0 }] }],
  }]);
  expect(result).toMatchObject({ ok: true, width: 8, height: 4 });
  // Blue exactly on x 2..4, y 1..2; red everywhere else.
  const rows = py(`
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
print("\\n".join("".join("B" if im.getpixel((x, y))[2] > 128 else "R" for x in range(im.width)) for y in range(im.height)))
`, dst).split(/\r?\n/);
  expect(rows).toEqual(["RRRRRRRR", "RRBBBRRR", "RRBBBRRR", "RRRRRRRR"]);
});
