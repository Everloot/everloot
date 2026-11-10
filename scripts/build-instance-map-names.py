"""Export game-file instance names/types, including maps with no entrance coordinates.

python scripts/build-instance-map-names.py <client snapshot.sqlite>
"""
import json
import sqlite3
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
with sqlite3.connect(Path(sys.argv[1]).resolve().as_uri() + "?mode=ro", uri=True) as db:
    meta = dict(db.execute("SELECT key, value FROM meta"))
    maps = [json.loads(row[0]) for row in db.execute("SELECT raw FROM client_rows WHERE tbl = 'Map' ORDER BY id")]
data = {
    "build": meta["version"],
    "label": "Found in game files, unconfirmed; game data copyright Blizzard Entertainment, Inc.",
    "instances": [{"id": r["ID"], "name": r["MapName_lang"], "raid": r["InstanceType"] == 2}
                  for r in maps if str(r["ID"]) in json.loads((root / "web/src/data/game-data/client-encounters.json").read_text(encoding="utf-8"))["instances"]
                  and r.get("InstanceType") in (1, 2) and r.get("MapName_lang")],
}
(root / "addon/data/instance-map-names.json").write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
