import type { Metadata } from "next";
import { Callout, C, H2, List, P, Step, Steps, docLink } from "@/components/docs/blocks";
import { CodeGroup } from "@/components/docs/DocsClient";
import DocPage from "@/components/docs/DocPage";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";

export const metadata: Metadata = pageMetadata({
  title: "Market prices in a script",
  description: "Read Forever market values per auction house from JavaScript or Python with no installs, list the realms and houses with prices, and handle an empty answer.",
  path: "/docs/cookbook/prices-in-a-script",
});

const JS = `// Forever market values for one realm, per auction house. Run: node prices.mjs "Realm name" [Alliance|Horde|Neutral]
const die = (message) => {
  console.error(message);
  process.exit(1);
};
const BASE = "https://everloot.app";
const [realm, house] = process.argv.slice(2);

async function get(path) {
  const res = await fetch(\`\${BASE}\${path}\`);
  const body = await res.json();
  if (res.status === 429) die(\`Rate limited. Try again in \${res.headers.get("retry-after")} seconds.\`);
  if (!res.ok) die(\`\${res.status}: \${body.error ?? "request failed"}\`);
  return body;
}

// Without a realm the endpoint lists the realms that have public prices, and in houses which auction houses have them.
const list = await get("/api/market/prices");
if (!realm) {
  if (list.realms.length === 0) {
    console.log("No realm has public prices yet. A day is public once 3 reporters have scanned the item in that auction house.");
  } else {
    console.log("Realms with public prices:");
    for (const name of list.realms) console.log(\`  \${name}: \${(list.houses[name] ?? []).join(", ") || "no house yet"}\`);
    console.log('Run again with a realm, for example: node prices.mjs "<realm>"');
  }
  process.exit(0);
}

// Each auction house is its own market, so ask once per house: the one you named, or each house the list gives.
const listed = Object.entries(list.houses).find(([name]) => name.toLowerCase() === realm.toLowerCase())?.[1] ?? [];
const houses = house ? [house] : listed;
if (houses.length === 0) {
  console.log(\`No auction house on \${realm} has public prices yet.\`);
  process.exit(0);
}

const gold = (copper) => \`\${Math.floor(copper / 10000)}g \${Math.floor((copper % 10000) / 100)}s \${copper % 100}c\`;
let credit = list.attribution.credit;
for (const name of houses) {
  const data = await get(\`/api/market/prices?realm=\${encodeURIComponent(realm)}&house=\${encodeURIComponent(name.toLowerCase())}\`);
  credit = data.attribution.credit;
  console.log(\`\${data.house} auction house:\`);
  if (data.items.length === 0) {
    console.log("  No public prices yet.");
    continue;
  }
  // Each item is a tuple in the order given by data.fields.
  const rows = data.items.map((tuple) => Object.fromEntries(data.fields.map((field, i) => [field, tuple[i]])));
  for (const row of rows.slice(0, 10)) {
    console.log(\`  item \${row.itemId}: market \${gold(row.market)}, lowest \${gold(row.min)}, \${row.quantity} listed (\${row.day})\`);
  }
}
console.log(credit);`;
const PY = `"""Forever market values for one realm, per auction house. Run: python prices.py "Realm name" [Alliance|Horde|Neutral]"""
import json
import os
import sys
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

BASE = "https://everloot.app"


def get(path):
    try:
        request = Request(BASE + path, headers={"User-Agent": "everloot-cookbook/1.0"})
        with urlopen(request, timeout=30) as res:
            return json.load(res)
    except HTTPError as err:
        if err.code == 429:
            raise SystemExit(f"Rate limited. Try again in {err.headers['Retry-After']} seconds.")
        body = json.load(err)
        raise SystemExit(f"{err.code}: {body.get('error', 'request failed')}")


def gold(copper):
    return f"{copper // 10000}g {copper % 10000 // 100}s {copper % 100}c"


realm = sys.argv[1] if len(sys.argv) > 1 else None
house = sys.argv[2] if len(sys.argv) > 2 else None

# Without a realm the endpoint lists the realms that have public prices, and in "houses" which auction houses have them.
listing = get("/api/market/prices")
if realm is None:
    if not listing["realms"]:
        print("No realm has public prices yet. A day is public once 3 reporters have scanned the item in that auction house.")
    else:
        print("Realms with public prices:")
        for name in listing["realms"]:
            print(f"  {name}: {', '.join(listing['houses'].get(name, [])) or 'no house yet'}")
        print('Run again with a realm, for example: python prices.py "<realm>"')
    raise SystemExit(0)

# Each auction house is its own market, so ask once per house: the one you named, or each house the list gives.
listed = next((h for name, h in listing["houses"].items() if name.lower() == realm.lower()), [])
houses = [house] if house else listed
if not houses:
    print(f"No auction house on {realm} has public prices yet.")
    raise SystemExit(0)

credit = listing["attribution"]["credit"]
for name in houses:
    data = get("/api/market/prices?realm=" + quote(realm) + "&house=" + quote(name.lower()))
    credit = data["attribution"]["credit"]
    print(f"{data['house']} auction house:")
    if not data["items"]:
        print("  No public prices yet.")
        continue
    # Each item is a list in the order given by data["fields"].
    for tuple_ in data["items"][:10]:
        row = dict(zip(data["fields"], tuple_))
        print(f"  item {row['itemId']}: market {gold(row['market'])}, lowest {gold(row['min'])}, {row['quantity']} listed ({row['day']})")
print(credit)`;

const RUN_JS = `node prices.mjs`;
const RUN_PY = `python prices.py`;

const REALMS_RAW = `{
  "ok": true,
  "dataAsOf": "2026-10-20T06:20:28.878Z",
  "realms": [],
  "houses": {},
  "attribution": { "licence": "CC BY-SA 4.0", "credit": "Data from Everloot (https://everloot.app), CC BY-SA 4.0.", "…": "…" }
}`;

const EMPTY_OUT = `No realm has public prices yet. A day is public once 3 reporters have scanned the item in that auction house.`;

const SHAPE = `{
  "ok": true,
  "dataAsOf": "…",
  "rule": "A day is public when 3 reporters scanned this item on this realm with a full scan …",
  "fields": ["itemId", "market", "min", "historical", "quantity", "day", "reporters"],
  "realm": "<realm>",
  "house": "Alliance",
  "items": [
    [2589, 12345, 11000, 12000, 800, "2026-11-04", 4]
  ],
  "attribution": { "…": "…" }
}`;

const FILLED_OUT = `Realms with public prices:
  <realm>: Alliance, Horde
Run again with a realm, for example: node prices.mjs "<realm>"`;

const ITEMS_OUT = `Alliance auction house:
  item 2589: market 1g 23s 45c, lowest 1g 10s 0c, 800 listed (2026-11-04)
  item 2592: market 0g 2s 50c, lowest 0g 2s 0c, 90 listed (2026-11-04)
Horde auction house:
  item 2589: market 1g 41s 0c, lowest 1g 30s 0c, 310 listed (2026-11-04)
Data from Everloot (https://everloot.app), CC BY-SA 4.0.`;

export default function Page() {
  return (
    <DocPage href="/docs/cookbook/prices-in-a-script">
      <Callout kind="tip">
        <p><strong>Goal.</strong> Read Forever auction market values from a script, in JavaScript or in Python.</p>
        <p><strong>Outcome.</strong> A script that lists the realms and auction houses with public prices, then prints the market value, lowest buyout and units listed for the items in each house of one realm.</p>
      </Callout>

      <H2 id="prerequisites">Prerequisites</H2>
      <List>
        <li>Node 18 or newer, for the built-in <C>fetch</C>, or Python 3 with only its standard library. Nothing to install in either case.</li>
        <li>No account and no key. The endpoint is <C>GET /api/market/prices</C>.</li>
      </List>

      <Callout kind="note">
        <p>Prices come only from scans players make from WoW: Forever&apos;s launch on 4 November 2026, and an auction house has no public prices until 3 reporters scan an item in it (while few players upload, Everloot&apos;s own scans can make a day public alone; their <C>reporters</C> is then under 3). Until then the scripts print the empty-answer message in step 3. The output in step 4 uses placeholder values, so you can see its shape.</p>
      </Callout>

      <H2 id="steps">Steps</H2>
      <Steps>
        <Step title="Know the two answers" id="two-answers">
          <p className="mt-2 leading-7 text-fg-2">Without a <C>realm</C>, the endpoint lists the realms that have public prices, and in <C>houses</C> which auction houses of each realm have them. With a <C>realm</C> and a <C>house</C>, it returns the items with the most units listed in that house.</p>
          <p className="mt-4 leading-7 text-fg-2">Each auction house is its own market, and Alliance and Horde prices can be far apart, so ask once per house. Without <C>house</C>, the answer holds only scans that recorded no house, from older addons. It is usually empty and is not the price in any house.</p>
          <div className="mt-6"><CodeGroup title="GET /api/market/prices" tabs={[{ label: "No realm", lang: "json", code: REALMS_RAW }, { label: "A realm and a house", lang: "json", code: SHAPE }]} /></div>
          <p className="mt-4 leading-7 text-fg-2">Items are lists, not objects. <C>fields</C> gives the order, so read it rather than counting positions. Prices are copper per unit: 10,000 copper is 1 gold, 100 copper is 1 silver.</p>
        </Step>
        <Step title="Save the script" id="save">
          <p className="mt-2 leading-7 text-fg-2">Save one of these as <C>prices.mjs</C> or <C>prices.py</C>. With no realm it lists the realms and their houses. Given a realm, it asks each house the list names and prints up to ten items under each house&apos;s name; put a house after the realm to ask for that one only. It handles an empty list, and stops with the wait time on a 429.</p>
          <div className="mt-6"><CodeGroup title="prices" tabs={[{ label: "JavaScript", lang: "js", code: JS }, { label: "Python", lang: "python", code: PY }]} /></div>
        </Step>
        <Step title="Run it" id="run">
          <p className="mt-2 leading-7 text-fg-2">Run it with no realm first.</p>
          <div className="mt-6"><CodeGroup title="Run" tabs={[{ label: "JavaScript", lang: "bash", code: RUN_JS }, { label: "Python", lang: "bash", code: RUN_PY }]} /></div>
          <p className="mt-4 leading-7 text-fg-2">With no public prices both print this, which is what an empty answer looks like:</p>
          <div className="mt-6"><CodeGroup title="Output" tabs={[{ label: "Output", lang: "text", code: EMPTY_OUT }]} /></div>
        </Step>
        <Step title="Ask for a realm" id="realm">
          <p className="mt-2 leading-7 text-fg-2">Once a realm has public prices, the first run lists it with its houses, and you pass its name as the argument. Placeholder values:</p>
          <div className="mt-6"><CodeGroup title="First run, then a realm" tabs={[{ label: "First run", lang: "text", code: FILLED_OUT }, { label: "With a realm", lang: "text", code: ITEMS_OUT }]} /></div>
          <p className="mt-4 leading-7 text-fg-2">A realm the list does not name, or one that does not exist, has no house to ask, and the script says so. A house you name that has no public prices gives an empty <C>items</C> list.</p>
        </Step>
      </Steps>

      <H2 id="check">Check your work</H2>
      <List>
        <li>With no realm, the script prints either the empty-answer line or a list of realm names with their houses. A stack trace means the request failed; read its first line.</li>
        <li>With a realm, every item line sits under its house&apos;s name and has an item id and three numbers. The copper amounts are whole numbers; if you see decimals, you are not reading this endpoint.</li>
        <li>The last line is the credit line. Show it wherever you publish these values.</li>
        <li>A run with a realm makes one request for the list and one per house. This endpoint allows 200 requests an hour for each IP address. Over that, the answer is a 429 with a <C>Retry-After</C> header in seconds, and the script prints it: <C>{`Rate limited. Try again in 3132 seconds.`}</C></li>
      </List>
      <P>An empty list means no public values yet. It does not mean the price is zero.</P>

      <H2 id="next-steps">Next steps</H2>
      <List>
        <li><Link href="/docs/api/market-prices" className={docLink}>/market/prices</Link>: every field and the rule for when a day is public.</li>
        <li><Link href="/docs/mcp/tools/market-value" className={docLink}>market_value</Link>: one item&apos;s value and history, over MCP or <Link href="/docs/cookbook/tools-over-http" className={docLink}>plain HTTP</Link>.</li>
        <li><Link href="/docs/licence" className={docLink}>Licence and credit</Link>: the credit line to show.</li>
      </List>
    </DocPage>
  );
}
