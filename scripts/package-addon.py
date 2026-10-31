"""Build the beta zip from the TOC allowlist: python scripts/package-addon.py"""
from pathlib import Path
from hashlib import sha256
import re
from zipfile import ZipFile, ZipInfo, ZIP_STORED

root = Path(__file__).resolve().parents[1]
addon = root / "addon"
toc = (addon / "Everloot.toc").read_text(encoding="utf-8")
version = re.search(r"^## Version: ([0-9][0-9A-Za-z.+-]*)\s*$", toc, re.M).group(1)
core_version = re.search(r'^E\.VERSION = "([^"]+)"', (addon / "core.lua").read_text(encoding="utf-8"), re.M).group(1)
# A nightly build stamps "0.3.1-nightly.<date>.<run>" into the TOC and "0.3.1-nightly" into core.lua
# (the upload intake allows 20 characters), in the CI copy only. A release has the same text in both.
assert core_version == version or ("-" in version and core_version.startswith(version.split("-")[0] + "-")), (version, core_version)
paths = ["Everloot.toc"] + [line.strip().replace("\\", "/") for line in toc.splitlines() if line.strip() and not line.startswith("#")]
# Textures are not listed in a TOC: every TGA under addon/media ships, byte for byte.
media = sorted(p.relative_to(addon).as_posix() for p in (addon / "media").glob("*.tga"))
output = root / "web" / "public" / "downloads" / f"Everloot-{version}.zip"
output.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(output, "w", compression=ZIP_STORED) as archive:
    for relative in paths + media:
        source = (addon / relative).resolve()
        assert source.is_relative_to(addon.resolve()) and source.suffix in [".toc", ".lua", ".tga"]
        entry = ZipInfo(f"Everloot/{relative}", date_time=(2000, 1, 1, 0, 0, 0))
        # Stable across host OS and zlib versions; this source-only archive is small.
        entry.create_system = 3
        entry.external_attr = 0o100644 << 16
        entry.compress_type = ZIP_STORED
        data = source.read_bytes() if source.suffix == ".tga" else source.read_text(encoding="utf-8").encode("utf-8")
        archive.writestr(entry, data)
print(f"{output.name}: {len(paths)} source files, {len(media)} textures, sha256 {sha256(output.read_bytes()).hexdigest()}")
