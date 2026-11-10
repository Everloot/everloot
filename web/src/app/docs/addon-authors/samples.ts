/**
 * The code on the "Use the data in your addon" page. They are strings so the page can show them and the page's test can
 * run them, against the real corpus route, with the address swapped for a local one. Keep BASE the only address in them.
 * The JavaScript uses no template literals so it needs no escaping here.
 */

export const CURL_FIRST = `curl "https://everloot.app/api/corpus/public?kinds=loot&limit=500"`;

export const CURL_KEY = `curl "https://everloot.app/api/corpus/public?kinds=loot&limit=5000" \\
  -H "Authorization: Bearer $EVERLOOT_API_KEY"`;

export const CURL_SKINNING = `curl -s "https://everloot.app/api/corpus/public?kinds=loot&limit=500" \\
  | jq '{dataAsOf, next, skinning: [.records[] | select(.lootType == "skinning")]}'`;

export const ROW = `{
  "kind": "loot",
  "installId": "pub-0123456789abcdef0123456789abcdef",
  "eventId": "loot:example:1",
  "capturedAt": "2026-11-05T19:42:10.000Z",
  "lootType": "skinning",
  "sourceNpcId": 1234,
  "sourceEvidence": "loot-api",
  "items": [{ "itemId": 2318, "count": 1 }]
}`;

export const JS = `// Skinning loot for every creature, saved as skinning.json. Run: node skinning.mjs
import { writeFile } from "node:fs/promises";

const BASE = "https://everloot.app";
const KEY = process.env.EVERLOOT_API_KEY; // optional: a free key allows bigger pages and more requests
const LIMIT = KEY ? 5000 : 500;
const headers = KEY ? { Authorization: "Bearer " + KEY } : {};

// Every loot record, or null when dataAsOf changed between two pages: the snapshot was rebuilt, so start over.
async function readAll() {
  let url = BASE + "/api/corpus/public?kinds=loot&limit=" + LIMIT;
  let asOf = "unset";
  let credit = "";
  const records = [];
  while (url) {
    const res = await fetch(url, { headers });
    const page = await res.json();
    if (res.status === 429) throw new Error("Rate limited. Try again in " + res.headers.get("retry-after") + " seconds.");
    if (!res.ok) throw new Error(res.status + ": " + (page.error ?? "request failed"));
    if (asOf !== "unset" && (page.dataAsOf ?? null) !== asOf) return null;
    asOf = page.dataAsOf ?? null;
    credit = page.attribution.credit;
    records.push(...page.records);
    url = page.next ? new URL(page.next, BASE).href : null; // null on the last page
  }
  return { records, dataAsOf: asOf, credit };
}

let read = null;
for (let attempt = 0; attempt < 3 && !read; attempt++) read = await readAll();
if (!read) throw new Error("dataAsOf kept changing. Try again in ten minutes.");

// One entry per creature: its skinning windows, the installs behind them, and how many windows held each item.
const bySource = new Map();
for (const r of read.records) {
  if (r.lootType !== "skinning" || !r.sourceNpcId) continue;
  const npc = bySource.get(r.sourceNpcId) ?? { windows: 0, installs: new Set(), items: new Map() };
  npc.windows += 1;
  if (r.installId) npc.installs.add(r.installId);
  for (const itemId of new Set(r.items.map((i) => i.itemId))) npc.items.set(itemId, (npc.items.get(itemId) ?? 0) + 1);
  bySource.set(r.sourceNpcId, npc);
}

const creatures = [...bySource].map(([sourceNpcId, n]) => ({
  sourceNpcId,
  windows: n.windows,
  installs: n.installs.size,
  confirmed: n.installs.size >= 3, // Everloot's rule: a fact needs 3 installs. Fewer is a single report.
  items: [...n.items].map(([itemId, windows]) => ({ itemId, windows })),
}));

// The pseudonyms stay out of the file: it holds counts, not install ids.
await writeFile("skinning.json", JSON.stringify({ credit: read.credit, dataAsOf: read.dataAsOf, creatures }, null, 2) + "\\n");
console.log("Wrote " + creatures.length + " creatures to skinning.json");
console.log(read.credit);`;

export const PY = `"""Skinning loot for every creature, saved as skinning.json. Run: python skinning.py"""
import json
import os
from urllib.error import HTTPError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

BASE = "https://everloot.app"
KEY = os.environ.get("EVERLOOT_API_KEY")  # optional: a free key allows bigger pages and more requests
LIMIT = 5000 if KEY else 500
HEADERS = {"User-Agent": "my-addon-pack/1.0"}
if KEY:
    HEADERS["Authorization"] = "Bearer " + KEY


def read_all():
    """Every loot record, or None when dataAsOf changed between two pages: the snapshot was rebuilt, so start over."""
    url = BASE + "/api/corpus/public?kinds=loot&limit=" + str(LIMIT)
    as_of = "unset"
    credit = ""
    records = []
    while url:
        try:
            with urlopen(Request(url, headers=HEADERS), timeout=30) as res:
                page = json.load(res)
        except HTTPError as err:
            if err.code == 429:
                raise SystemExit("Rate limited. Try again in " + err.headers["Retry-After"] + " seconds.")
            raise SystemExit(str(err.code) + ": " + json.load(err).get("error", "request failed"))
        if as_of != "unset" and page.get("dataAsOf") != as_of:
            return None
        as_of = page.get("dataAsOf")
        credit = page["attribution"]["credit"]
        records.extend(page["records"])
        url = urljoin(BASE, page["next"]) if page["next"] else None  # None on the last page
    return {"records": records, "dataAsOf": as_of, "credit": credit}


read = None
for _ in range(3):
    read = read or read_all()
if not read:
    raise SystemExit("dataAsOf kept changing. Try again in ten minutes.")

# One entry per creature: its skinning windows, the installs behind them, and how many windows held each item.
by_source = {}
for r in read["records"]:
    if r.get("lootType") != "skinning" or not r.get("sourceNpcId"):
        continue
    npc = by_source.setdefault(r["sourceNpcId"], {"windows": 0, "installs": set(), "items": {}})
    npc["windows"] += 1
    if r.get("installId"):
        npc["installs"].add(r["installId"])
    for item_id in {i["itemId"] for i in r["items"]}:
        npc["items"][item_id] = npc["items"].get(item_id, 0) + 1

creatures = [
    {
        "sourceNpcId": source,
        "windows": n["windows"],
        "installs": len(n["installs"]),
        "confirmed": len(n["installs"]) >= 3,  # Everloot's rule: a fact needs 3 installs. Fewer is a single report.
        "items": [{"itemId": item_id, "windows": w} for item_id, w in n["items"].items()],
    }
    for source, n in by_source.items()
]

# The pseudonyms stay out of the file: it holds counts, not install ids.
with open("skinning.json", "w", encoding="utf-8") as f:
    json.dump({"credit": read["credit"], "dataAsOf": read["dataAsOf"], "creatures": creatures}, f, indent=2)
    f.write("\\n")
print("Wrote " + str(len(creatures)) + " creatures to skinning.json")
print(read["credit"])`;

export const OUTPUT = `{
  "credit": "Data from Everloot (https://everloot.app), CC BY-SA 4.0.",
  "dataAsOf": "2026-11-10T12:00:00.000Z",
  "creatures": [
    {
      "sourceNpcId": 1234,
      "windows": 40,
      "installs": 5,
      "confirmed": true,
      "items": [{ "itemId": 2318, "windows": 31 }]
    }
  ]
}`;
