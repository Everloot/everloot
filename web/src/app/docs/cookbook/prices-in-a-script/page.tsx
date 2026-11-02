import type { Metadata } from "next";
import { Callout, C, H2, List, P, Step, Steps, docLink } from "@/components/docs/blocks";
import { CodeGroup } from "@/components/docs/DocsClient";
import DocPage from "@/components/docs/DocPage";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";

export const metadata: Metadata = pageMetadata({
  title: "Market prices in a script",
  description: "Read Forever market values from JavaScript or Python with no installs, list the realms that have prices, and handle the answer for a realm with no prices.",
  path: "/docs/cookbook/prices-in-a-script",
});

const JS = `// Forever market values for one realm. Run: node prices.mjs "Realm name"
const die = (message) => {
  console.error(message);
  process.exit(1);
};
const BASE = "https://everloot.app";
const realm = process.argv[2];

async function get(path) {
  const res = await fetch(\`\${BASE}\${path}\`);
  const body = await res.json();
  if (res.status === 429) die(\`Rate limited. Try again in \${res.headers.get("retry-after")} seconds.\`);
  if (!res.ok) die(\`\${res.status}: \${body.error ?? "request failed"}\`);
  return body;
}

if (!realm) {
  // Without a realm the endpoint lists the realms that have public prices.
  const { realms } = await get("/api/market/prices");
  if (realms.length === 0) {
    console.log("No realm has public prices yet. A day is public once 3 reporters have scanned the item on that realm.");
  } else {
    console.log("Realms with public prices:");
    for (const name of realms) console.log(\`  \${name}\`);
    console.log('Run again with a realm, for example: node prices.mjs "<realm>"');
  }
  process.exit(0);
}

const data = await get(\`/api/market/prices?realm=\${encodeURIComponent(realm)}\`);
if (data.items.length === 0) {
  console.log(\`No public prices for \${realm} yet.\`);
  process.exit(0);
}

// Each item is a tuple in the order given by data.fields.
const rows = data.items.map((tuple) => Object.fromEntries(data.fields.map((name, i) => [name, tuple[i]])));
const gold = (copper) => \`\${Math.floor(copper / 10000)}g \${Math.floor((copper % 10000) / 100)}s \${copper % 100}c\`;
for (const row of rows.slice(0, 10)) {
  console.log(\`item \${row.itemId}: market \${gold(row.market)}, lowest \${gold(row.min)}, \${row.quantity} listed (\${row.day})\`);
}
console.log(data.attribution.credit);`;
const PY = `"""Forever market values for one realm. Run: python prices.py "Realm name" """
import json
import os
import sys
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import urlopen

BASE = "https://everloot.app"


def get(path):
    try:
        with urlopen(BASE + path, timeout=30) as res:
            return json.load(res)
    except HTTPError as err:
        if err.code == 429:
            raise SystemExit(f"Rate limited. Try again in {err.headers['Retry-After']} seconds.")
        body = json.load(err)
        raise SystemExit(f"{err.code}: {body.get('error', 'request failed')}")


def gold(copper):
    return f"{copper // 10000}g {copper % 10000 // 100}s {copper % 100}c"


realm = sys.argv[1] if len(sys.argv) > 1 else None

if realm is None:
    # Without a realm the endpoint lists the realms that have public prices.
    realms = get("/api/market/prices")["realms"]
    if not realms:
        print("No realm has public prices yet. A day is public once 3 reporters have scanned the item on that realm.")
    else:
        print("Realms with public prices:")
        for name in realms:
            print("  " + name)
        print('Run again with a realm, for example: python prices.py "<realm>"')
    raise SystemExit(0)

data = get("/api/market/prices?realm=" + quote(realm))
if not data["items"]:
    print(f"No public prices for {realm} yet.")
    raise SystemExit(0)

# Each item is a list in the order given by data["fields"].
for tuple_ in data["items"][:10]:
    row = dict(zip(data["fields"], tuple_))
    print(f"item {row['itemId']}: market {gold(row['market'])}, lowest {gold(row['min'])}, {row['quantity']} listed ({row['day']})")
print(data["attribution"]["credit"])`;

const RUN_JS = `node prices.mjs`;
const RUN_PY = `python prices.py`;

const REALMS_RAW = `{
  "ok": true,
  "dataAsOf": "2026-10-20T06:20:28.878Z",
  "realms": [],
  "attribution": { "licence": "CC BY-SA 4.0", "credit": "Data from Everloot (https://everloot.app), CC BY-SA 4.0.", "…": "…" }
}`;

const EMPTY_OUT = `No realm has public prices yet. A day is public once 3 reporters have scanned the item on that realm.`;

const SHAPE = `{
  "ok": true,
  "dataAsOf": "…",
  "rule": "A day is public when 3 reporters scanned this item on this realm with a full scan …",
  "fields": ["itemId", "market", "min", "historical", "quantity", "day", "reporters"],
  "realm": "<realm>",
  "items": [
    [2589, 12345, 11000, 12000, 800, "2026-11-04", 4]
  ],
  "attribution": { "…": "…" }
}`;

const FILLED_OUT = `Realms with public prices:
  <realm>
Run again with a realm, for example: node prices.mjs "<realm>"`;

const ITEMS_OUT = `item 2589: market 1g 23s 45c, lowest 1g 10s 0c, 800 listed (2026-11-04)
item 2592: market 0g 2s 50c, lowest 0g 2s 0c, 90 listed (2026-11-04)
Data from Everloot (https://everloot.app), CC BY-SA 4.0.`;

export default function Page() {
  return (
    <DocPage href="/docs/cookbook/prices-in-a-script">
      <Callout kind="tip">
        <p><strong>Goal.</strong> Read Forever auction market values from a script, in JavaScript or in Python.</p>
        <p><strong>Outcome.</strong> A script that lists the realms with public prices, then prints the market value, lowest buyout and units listed for the items on one realm.</p>
      </Callout>

      <H2 id="prerequisites">Prerequisites</H2>
      <List>
        <li>Node 18 or newer, for the built-in <C>fetch</C>, or Python 3 with only its standard library. Nothing to install in either case.</li>
        <li>No account and no key. The endpoint is <C>GET /api/market/prices</C>.</li>
      </List>

      <Callout kind="note">
        <p>Prices come only from scans players make from WoW: Forever&apos;s launch on 4 November 2026, and a realm has no public prices until 3 reporters scan an item on it. Until then the scripts print the empty-answer message in step 3. The output in step 4 uses placeholder values, so you can see its shape.</p>
      </Callout>

      <H2 id="steps">Steps</H2>
      <Steps>
        <Step title="Know the two answers" id="two-answers">
          <p className="mt-2 leading-7 text-fg-2">Without a <C>realm</C>, the endpoint lists the realms that have public prices. With one, it returns the items with the most units listed on that realm.</p>
          <div className="mt-6"><CodeGroup title="GET /api/market/prices" tabs={[{ label: "No realm", lang: "json", code: REALMS_RAW }, { label: "With a realm", lang: "json", code: SHAPE }]} /></div>
          <p className="mt-4 leading-7 text-fg-2">Items are lists, not objects. <C>fields</C> gives the order, so read it rather than counting positions. Prices are copper per unit: 10,000 copper is 1 gold, 100 copper is 1 silver.</p>
        </Step>
        <Step title="Save the script" id="save">
          <p className="mt-2 leading-7 text-fg-2">Save one of these as <C>prices.mjs</C> or <C>prices.py</C>. It lists the realms when you give it none, and prints up to ten items when you give it a realm. It handles an empty list, and stops with the wait time on a 429.</p>
          <div className="mt-6"><CodeGroup title="prices" tabs={[{ label: "JavaScript", lang: "js", code: JS }, { label: "Python", lang: "python", code: PY }]} /></div>
        </Step>
        <Step title="Run it" id="run">
          <p className="mt-2 leading-7 text-fg-2">Run it with no realm first.</p>
          <div className="mt-6"><CodeGroup title="Run" tabs={[{ label: "JavaScript", lang: "bash", code: RUN_JS }, { label: "Python", lang: "bash", code: RUN_PY }]} /></div>
          <p className="mt-4 leading-7 text-fg-2">With no public prices both print this, which is what an empty answer looks like:</p>
          <div className="mt-6"><CodeGroup title="Output" tabs={[{ label: "Output", lang: "text", code: EMPTY_OUT }]} /></div>
        </Step>
        <Step title="Ask for a realm" id="realm">
          <p className="mt-2 leading-7 text-fg-2">Once a realm has public prices, the first run lists it, and you pass its name as the argument. Placeholder values:</p>
          <div className="mt-6"><CodeGroup title="First run, then a realm" tabs={[{ label: "First run", lang: "text", code: FILLED_OUT }, { label: "With a realm", lang: "text", code: ITEMS_OUT }]} /></div>
          <p className="mt-4 leading-7 text-fg-2">A realm with no public prices, or one that does not exist, gives an empty <C>items</C> list, and the script says so.</p>
        </Step>
      </Steps>

      <H2 id="check">Check your work</H2>
      <List>
        <li>With no realm, the script prints either the empty-answer line or a list of realm names. A stack trace means the request failed; read its first line.</li>
        <li>With a realm, every line has an item id and three numbers. The copper amounts are whole numbers; if you see decimals, you are not reading this endpoint.</li>
        <li>The last line is the credit line. Show it wherever you publish these values.</li>
        <li>This endpoint allows 200 requests an hour for each IP address. Over that, the answer is a 429 with a <C>Retry-After</C> header in seconds, and the script prints it: <C>{`Rate limited. Try again in 3132 seconds.`}</C></li>
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
