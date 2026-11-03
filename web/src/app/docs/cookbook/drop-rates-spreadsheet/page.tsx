import type { Metadata } from "next";
import { Callout, C, H2, List, P, Step, Steps, docLink } from "@/components/docs/blocks";
import { CodeGroup } from "@/components/docs/DocsClient";
import DocPage from "@/components/docs/DocPage";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";

export const metadata: Metadata = pageMetadata({
  title: "Drop rates to a spreadsheet",
  description: "Page through Everloot's corroborated drop rates from JavaScript or Python, save them as a CSV file, and open it in a spreadsheet with the credit line.",
  path: "/docs/cookbook/drop-rates-spreadsheet",
});

const JS = `// Every corroborated drop rate, saved as drops.csv. Run: node drops.mjs
import { writeFile } from "node:fs/promises";

const die = (message) => {
  console.error(message);
  process.exit(1);
};
const BASE = "https://everloot.app";
let url = \`\${BASE}/api/rollups/drops?limit=500\`;
const rates = [];
let credit = "";

while (url) {
  const res = await fetch(url);
  const page = await res.json();
  if (res.status === 429) die(\`Rate limited. Try again in \${res.headers.get("retry-after")} seconds.\`);
  if (!res.ok) die(\`\${res.status}: \${page.error ?? "request failed"}\`);
  if (page.unreachable) die("Storage could not be read; the empty list is not a zero. Try again later.");
  rates.push(...page.rates);
  credit = page.attribution.credit;
  url = page.next ? new URL(page.next, BASE).href : null; // null on the last page
}

const header = ["source_type", "source_id", "item_id", "kills", "drops", "rate", "reporters"];
const lines = rates.map((r) => [
  r.sourceNpcId ? "npc" : "object",
  r.sourceNpcId ?? r.sourceObjectId,
  r.itemId, r.kills, r.drops, r.rate, r.reporters,
].join(","));

await writeFile("drops.csv", [header.join(","), ...lines].join("\\n") + "\\n");
await writeFile("drops-credit.txt", credit + "\\n");
console.log(\`Wrote \${rates.length} drop rates to drops.csv\`);
console.log(credit);`;
const PY = `"""Every corroborated drop rate, saved as drops.csv. Run: python drops.py"""
import csv
import json
import os
from urllib.error import HTTPError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

BASE = "https://everloot.app"
url = BASE + "/api/rollups/drops?limit=500"
rates = []
credit = ""

while url:
    try:
        request = Request(url, headers={"User-Agent": "everloot-cookbook/1.0"})
        with urlopen(request, timeout=30) as res:
            page = json.load(res)
    except HTTPError as err:
        if err.code == 429:
            raise SystemExit(f"Rate limited. Try again in {err.headers['Retry-After']} seconds.")
        raise SystemExit(f"{err.code}: {json.load(err).get('error', 'request failed')}")
    if page["unreachable"]:
        raise SystemExit("Storage could not be read; the empty list is not a zero. Try again later.")
    rates.extend(page["rates"])
    credit = page["attribution"]["credit"]
    url = urljoin(BASE, page["next"]) if page["next"] else None  # None on the last page

with open("drops.csv", "w", newline="", encoding="utf-8") as f:
    out = csv.writer(f)
    out.writerow(["source_type", "source_id", "item_id", "kills", "drops", "rate", "reporters"])
    for r in rates:
        npc = r.get("sourceNpcId")
        out.writerow(["npc" if npc else "object", npc or r["sourceObjectId"],
                      r["itemId"], r["kills"], r["drops"], r["rate"], r["reporters"]])

with open("drops-credit.txt", "w", encoding="utf-8") as f:
    f.write(credit + "\\n")
print(f"Wrote {len(rates)} drop rates to drops.csv")
print(credit)`;

const PAGE_SHAPE = `{
  "rates": [
    { "sourceNpcId": 100, "itemId": 900, "kills": 40, "drops": 4, "rate": 0.1, "reporters": 3, "public": true }
  ],
  "measuredZeros": [],
  "offset": 0,
  "limit": 500,
  "total": 1,
  "totalRates": 1,
  "next": null,
  "attribution": { "credit": "Data from Everloot (https://everloot.app), CC BY-SA 4.0.", "…": "…" }
}`;

const RUN_JS = `node drops.mjs`;
const RUN_PY = `python drops.py`;

const EMPTY_OUT = `Wrote 0 drop rates to drops.csv
Data from Everloot (https://everloot.app), CC BY-SA 4.0.`;

const EMPTY_CSV = `source_type,source_id,item_id,kills,drops,rate,reporters`;

const FILLED_CSV = `source_type,source_id,item_id,kills,drops,rate,reporters
npc,100,900,40,4,0.1,3
npc,101,901,41,5,0.12195121951219512,3`;

export default function Page() {
  return (
    <DocPage href="/docs/cookbook/drop-rates-spreadsheet">
      <Callout kind="tip">
        <p><strong>Goal.</strong> Get every corroborated drop rate into a spreadsheet.</p>
        <p><strong>Outcome.</strong> A <C>drops.csv</C> file with one row per source and item, and the credit line saved beside it.</p>
      </Callout>

      <H2 id="prerequisites">Prerequisites</H2>
      <List>
        <li>Node 18 or newer, or Python 3 with only its standard library. Nothing to install.</li>
        <li>A spreadsheet that opens CSV files: Excel, Google Sheets, LibreOffice or Numbers.</li>
        <li>No account. Without a key, this endpoint allows 30 requests an hour for each IP address, shared with the corpus, items, edges and tools endpoints, and up to 500 rows a page. <Link href="/docs/api/keys" className={docLink}>Limits and keys</Link> explains the free key that raises both.</li>
      </List>

      <Callout kind="note">
        <p>Drop rates come only from loot players record from WoW: Forever&apos;s launch on 4 November 2026, and a source has no public drop rate until 3 installs loot it, so the answer can be an empty list. The empty output below is what an empty answer gives; the rows shown after it are placeholders, so you can see the shape.</p>
      </Callout>

      <H2 id="steps">Steps</H2>
      <Steps>
        <Step title="Read one page" id="one-page">
          <p className="mt-2 leading-7 text-fg-2">A page of <C>GET /api/rollups/drops</C> has the rates, the credit line and a <C>next</C> link. A rate is public once three installs looted its source. Trimmed, with placeholder values:</p>
          <div className="mt-6"><CodeGroup title="One page" tabs={[{ label: "Response", lang: "json", code: PAGE_SHAPE }]} /></div>
          <p className="mt-4 leading-7 text-fg-2"><C>kills</C> counts loot windows players opened on the source, not kills counted by the game. A rate has either <C>sourceNpcId</C> or <C>sourceObjectId</C>. <C>rate</C> is a fraction from 0 to 1.</p>
        </Step>
        <Step title="Follow next until it is null" id="paging">
          <p className="mt-2 leading-7 text-fg-2">Ask for 500 rows at a time. While <C>next</C> holds an address, fetch it. When it is <C>null</C>, you have everything. The scripts do that, then write the CSV and a second file with the credit line.</p>
          <div className="mt-6"><CodeGroup title="drops" tabs={[{ label: "JavaScript", lang: "js", code: JS }, { label: "Python", lang: "python", code: PY }]} /></div>
          <p className="mt-4 leading-7 text-fg-2">The same endpoint also lists <C>measuredZeros</C>: sources players looted with nothing in their windows. The scripts leave them out. If the storage cannot be read, the answer says so, and the scripts stop instead of writing an empty file that looks like a result.</p>
        </Step>
        <Step title="Run it" id="run">
          <div className="mt-6"><CodeGroup title="Run" tabs={[{ label: "JavaScript", lang: "bash", code: RUN_JS }, { label: "Python", lang: "bash", code: RUN_PY }]} /></div>
          <p className="mt-4 leading-7 text-fg-2">With no public rates it prints this, and <C>drops.csv</C> holds only the header row:</p>
          <div className="mt-6"><CodeGroup title="Output" tabs={[{ label: "Output", lang: "text", code: EMPTY_OUT }, { label: "drops.csv, empty", lang: "text", code: EMPTY_CSV }]} /></div>
          <p className="mt-4 leading-7 text-fg-2">Once rates exist, each one is a row. Placeholder rows:</p>
          <div className="mt-6"><CodeGroup title="drops.csv" tabs={[{ label: "With rates", lang: "text", code: FILLED_CSV }]} /></div>
        </Step>
        <Step title="Open it in a spreadsheet" id="spreadsheet">
          <p className="mt-2 leading-7 text-fg-2">Open <C>drops.csv</C> in Excel, LibreOffice or Numbers, or in Google Sheets with <strong>File, Import, Upload</strong>. Format the <C>rate</C> column as a percentage. Then sort by <C>kills</C> to see the best-measured rates first.</p>
        </Step>
        <Step title="Add the credit line" id="credit">
          <p className="mt-2 leading-7 text-fg-2">The data is CC BY-SA 4.0 and has to be credited. Open <C>drops-credit.txt</C> and paste its line under the table, or into the sheet&apos;s header. It is the <C>CREDIT_LINE</C> from <C>@everloot/protocol</C>, and the endpoint sends it in <C>attribution.credit</C> and in the <C>X-Everloot-Credit</C> header. If you publish the sheet or anything built from it, keep the line with it. <Link href="/docs/licence" className={docLink}>Licence and credit</Link> has the full terms.</p>
        </Step>
      </Steps>

      <H2 id="check">Check your work</H2>
      <List>
        <li>The script prints how many rates it wrote and the credit line. The row count in the spreadsheet is that number plus the header row.</li>
        <li>Every <C>rate</C> is between 0 and 1.</li>
        <li><C>drops-credit.txt</C> holds one line starting with &quot;Data from Everloot&quot;.</li>
        <li>A 429 stops the script with <C>Rate limited. Try again in N seconds.</C> N is the <C>Retry-After</C> header. Wait that long, or use a free key.</li>
        <li>A file with only the header row is a real answer. It means no source has three installs behind it yet, not that nothing drops.</li>
      </List>
      <P>You can also ask for a smaller page with <C>?offset=0&amp;limit=100</C>. A <C>limit</C> above your page size is capped, and <C>next</C> still leads on.</P>

      <H2 id="next-steps">Next steps</H2>
      <List>
        <li><Link href="/docs/api/rollups-drops" className={docLink}>/rollups/drops</Link>: every field.</li>
        <li><Link href="/docs/api/data-files" className={docLink}>Data files</Link>: bulk downloads, if you want everything at once.</li>
        <li><Link href="/docs/cookbook/prices-in-a-script" className={docLink}>Market prices in a script</Link>: the same idea for prices.</li>
      </List>
    </DocPage>
  );
}
