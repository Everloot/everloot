"""Build addon/modules/flight_times.lua from InFlight's measured flight times (MIT).

    python scripts/build-flight-times.py <InFlight Defaults.lua> <InFlight commit>

Reads the `global_classic` and `global_forever` tables of InFlight's Defaults.lua and merges them the way InFlight
itself does on WoW Forever: the Classic Era times, then Forever's own on top, per destination. Whole routes, stops
included, keyed by the game files' TaxiNodes ids (the Alliance and Horde maps have their own ids, so the faction
is not needed). Times only: none of InFlight's code is copied. Needs lupa (as the addon tests do).
"""
import sys
from pathlib import Path
from lupa.lua51 import LuaRuntime

root = Path(__file__).resolve().parents[1]
source, commit = Path(sys.argv[1]), sys.argv[2]
assert len(commit) == 40, "pin the full InFlight commit"
text = source.read_text(encoding="utf-8")
start, end = text.index("local global_classic = {"), text.index("-- Make these available for export.")
classic, forever = LuaRuntime().execute(text[start:end] + "\nreturn global_classic, global_forever")

times: dict[tuple[int, int], int] = {}
for table in (classic, forever):
    for nodes in table.values():
        for a, destinations in nodes.items():
            for b, seconds in destinations.items():
                if isinstance(a, int) and isinstance(b, int) and isinstance(seconds, (int, float)) and a != b and seconds > 0:
                    times[(a, b)] = round(seconds)

NOTICE = """InFlight, https://github.com/LudiusMaximus/InFlight
MIT License

Copyright (c) 2009-2024 TotalPackage, 2022 Deranjata, 2025-2026 LudiusMaximus

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE."""

lines = [
    f"-- Measured flight times in seconds, whole routes with their stops, from InFlight's Defaults.lua at {commit}:",
    "-- its Classic Era times with its WoW Forever corrections on top. Regenerate with scripts/build-flight-times.py.",
    "--",
    *[f"-- {line}".rstrip() for line in NOTICE.splitlines()],
    "local E = Everloot",
    "E.FLIGHT_TIMES = {",
    *[f'  ["{a}-{b}"] = {s},' for (a, b), s in sorted(times.items())],
    "}",
]
out = root / "addon" / "modules" / "flight_times.lua"
out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"{out.relative_to(root)}: {len(times)} routes")
