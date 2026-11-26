"""Texture decoding and picture encoding for `client-renders`, with Pillow (the same reader as blp_convert.py).

Usage: python -E render_io.py <jobs.json>
jobs.json: a list of jobs, each one of
  {"decode": "in.blp", "dst": "out.rgba"}
      Reads a BLP texture and writes its first mip level as raw RGBA after an 8-byte header (width, height,
      little-endian u32).
  {"encode": "in.rgba", "dst": "out.webp", "size": 512, "quality": 90}
      Reads raw RGBA written by the renderer (same header), scales it down to size x size (the renderer draws
      at a larger size, so this smooths the edges) and saves lossy WebP with its transparency.
Prints one JSON object per job on stdout: {"dst", "ok", "width", "height", "error"}.
Reads only the files it is given.
"""
import json
import struct
import sys

from PIL import Image

from blp_convert import open_blp


def read_raw(path):
    with open(path, "rb") as f:
        data = f.read()
    width, height = struct.unpack("<II", data[:8])
    if len(data) != 8 + width * height * 4:
        raise ValueError("raw picture does not match its header")
    return Image.frombuffer("RGBA", (width, height), data[8:], "raw", "RGBA", 0, 1)


def run(job):
    if "decode" in job:
        im = open_blp(job["decode"]).convert("RGBA")
        with open(job["dst"], "wb") as f:
            f.write(struct.pack("<II", im.width, im.height))
            f.write(im.tobytes())
        return im.width, im.height
    im = read_raw(job["encode"])
    size = int(job["size"])
    if im.size != (size, size):
        im = im.resize((size, size), Image.LANCZOS)
    im.save(job["dst"], "WEBP", quality=int(job.get("quality") or 90))
    return im.width, im.height


def main():
    with open(sys.argv[1], encoding="utf-8") as f:
        jobs = json.load(f)
    for job in jobs:
        try:
            w, h = run(job)
            print(json.dumps({"dst": job["dst"], "ok": True, "width": w, "height": h, "error": None}), flush=True)
        except Exception as e:  # one bad file never stops the others
            print(json.dumps({"dst": job["dst"], "ok": False, "width": 0, "height": 0, "error": str(e)[:200]}), flush=True)


if __name__ == "__main__":
    main()
