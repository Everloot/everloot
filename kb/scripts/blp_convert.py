"""Convert Blizzard BLP textures to WebP with Pillow (which reads BLP). Used by `client-assets`.

Usage: python -E blp_convert.py <jobs.json>
jobs.json: [{"src": "in.blp", "dst": "out.webp", "crop": [l, t, r, b] | null, "scaleX": 1.33 | null, "max": 128 | null, "quality": 90 | null}]
  "scaleX" stretches the width after the crop (a classic loading screen, stored square, back to 4:3).
  "trim": true cuts away the transparent rows and columns at the edges (a newer loading screen's empty
  bands, which fade out): the picture keeps the box of its near-opaque pixels.
  A job with "tiles" stitches map tiles instead of reading "src":
  {"dst", "tiles": [{"src": "t.blp", "row": 0, "col": 0}], "tile": [256, 256], "crop": [0, 0, w, h], "max": 1024, "quality": 80}
  and "overlays": [{"x", "y", "width", "height", "tiles": [{"src", "row", "col"}]}] drawn over the stitched
  tiles at x, y (the explored-area pictures of a zone map), each tile "tile"-sized and cut to the overlay.
  "quality" absent or null: lossless WebP. A number: lossy WebP at that quality (icons and map art).
Prints one JSON object per job on stdout: {"dst", "ok", "width", "height", "error"}.
Reads only the files it is given. Pillow decodes palette and DXT BLPs; the newer interface atlases are
BLP2 "encoding 3", plain 32-bit BGRA pixels that Pillow does not read, so those are unpacked here
(no compression, no encryption involved: the file is a header and raw pixels).
"""
import json
import struct
import sys

from PIL import Image


def read_raw_bgra(path):
    """BLP2 encoding 3: header, then the first mip level as raw BGRA. Anything else is refused."""
    with open(path, "rb") as f:
        data = f.read()
    if data[:4] != b"BLP2":
        raise ValueError("not a BLP2 file")
    kind, encoding, alpha_depth, _alpha_encoding, _has_mips = struct.unpack("<IBBBB", data[4:12])
    width, height = struct.unpack("<II", data[12:20])
    if kind != 1 or encoding != 3 or alpha_depth not in (0, 8):
        raise ValueError(f"unsupported BLP2 (type {kind}, encoding {encoding}, alpha {alpha_depth})")
    offset = struct.unpack("<I", data[20:24])[0]  # mip 0 offset (offsets: 16 x u32 from byte 20)
    size = struct.unpack("<I", data[84:88])[0]  # mip 0 size (sizes: 16 x u32 from byte 84)
    if size != width * height * 4 or offset + size > len(data):
        raise ValueError("BLP2 pixel data does not match its header")
    return Image.frombuffer("RGBA", (width, height), data[offset:offset + size], "raw", "BGRA", 0, 1)


def open_blp(path):
    try:
        im = Image.open(path)
        im.load()
        return im
    except Exception as first:
        if "Unknown BLP encoding 3" not in str(first):
            raise
        return read_raw_bgra(path)


def stitch(job):
    """Lays map tiles on a canvas by row and column. Every tile of the grid must be given: a map with a hole is refused."""
    tw, th = job["tile"]
    tiles = job["tiles"]
    cols = max(t["col"] for t in tiles) + 1
    rows = max(t["row"] for t in tiles) + 1
    if len(tiles) != cols * rows:
        raise ValueError(f"{len(tiles)} tiles do not fill a {cols} x {rows} grid")
    canvas = Image.new("RGBA", (cols * tw, rows * th))
    for t in tiles:
        canvas.paste(open_blp(t["src"]).convert("RGBA"), (t["col"] * tw, t["row"] * th))
    for overlay in job.get("overlays") or []:
        draw_overlay(canvas, overlay, tw, th)
    return canvas


def draw_overlay(canvas, overlay, tw, th):
    """An explored-area picture over the base art, blended by its alpha. Each tile covers a tile-sized cell from
    the overlay's corner; an edge tile's file can be bigger than the part of the overlay it holds (a power of
    two), so only its top-left part up to the overlay's size is drawn."""
    ox, oy, ow, oh = overlay["x"], overlay["y"], overlay["width"], overlay["height"]
    for t in overlay["tiles"]:
        im = open_blp(t["src"]).convert("RGBA")
        w = min(tw, ow - t["col"] * tw, im.width)
        h = min(th, oh - t["row"] * th, im.height)
        if w <= 0 or h <= 0:
            continue
        piece = im.crop((0, 0, w, h))
        canvas.alpha_composite(piece, (ox + t["col"] * tw, oy + t["row"] * th))


def main() -> int:
    with open(sys.argv[1], encoding="utf-8") as f:
        jobs = json.load(f)
    for job in jobs:
        result = {"dst": job["dst"], "ok": False, "width": 0, "height": 0, "error": None}
        try:
            im = stitch(job) if job.get("tiles") else open_blp(job["src"]).convert("RGBA")
            if job.get("crop"):
                im = im.crop(tuple(job["crop"]))
            if job.get("trim"):
                # The bands fade out with a little noise, so only near-opaque rows and columns count.
                box = im.getchannel("A").point(lambda v: 255 if v >= 250 else 0).getbbox()
                if box:
                    im = im.crop(box)
            scale_x = job.get("scaleX")
            if scale_x and abs(scale_x - 1) > 1e-6:
                im = im.resize((max(1, round(im.width * scale_x)), im.height), Image.LANCZOS)
            cap = job.get("max")
            if cap and max(im.size) > cap:
                im.thumbnail((cap, cap), Image.LANCZOS)
            quality = job.get("quality")
            if quality:
                im.save(job["dst"], "WEBP", lossless=False, quality=int(quality), method=6)
            else:
                im.save(job["dst"], "WEBP", lossless=True, quality=100, method=6)
            result.update(ok=True, width=im.width, height=im.height)
        except Exception as e:  # one bad file must not stop the rest
            result["error"] = f"{type(e).__name__}: {e}"
        print(json.dumps(result), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
