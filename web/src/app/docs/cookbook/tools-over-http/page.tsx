import type { Metadata } from "next";
import { Callout, C, H2, List, P, Step, Steps, Table, docLink } from "@/components/docs/blocks";
import { CodeGroup } from "@/components/docs/DocsClient";
import DocPage from "@/components/docs/DocPage";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";

export const metadata: Metadata = pageMetadata({
  title: "MCP tools over plain HTTP",
  description: "Call any Everloot MCP tool with a GET request from curl, JavaScript or Python: find its parameters, read the answer and handle 400, 404 and 429.",
  path: "/docs/cookbook/tools-over-http",
});

const SCHEMA_CMD = `curl -s https://everloot.app/schema/mcp/get_by_name.json | jq '{title, description, required: .inputSchema.required, properties: .inputSchema.properties}'`;
const SCHEMA_OUT = `{
  "title": "Get records by exact name",
  "description": "Exact full-name match (case-insensitive) for disambiguation.",
  "required": [
    "name"
  ],
  "properties": {
    "name": {
      "type": "string",
      "maxLength": 200,
      "description": "Full record name."
    },
    "kind": {
      "description": "Narrow to one record kind.",
      "type": "string",
      "enum": [
        "item",
        "npc",
        "object",
        "quest",
        "zone",
        "spell",
        "lore_page",
        "creator",
        "realm"
      ]
    }
  }
}`;

const CURL_CMD = `curl -s "https://everloot.app/api/tools/get_by_name?name=Thrall" | jq '{tool, arguments, text, schema}'`;
const CURL_OUT = `{
  "tool": "get_by_name",
  "arguments": {
    "name": "Thrall"
  },
  "text": "[lore_page/lore] Thrall\\nThrall (birthname Go'el), son of Durotan and Draka, is the former Warchief of the restored shamanistic Horde, founder of the nation of Durotar in Kalimdor and o…\\nSource: https://warcraft.wiki.gg/wiki/Thrall (CC-BY-SA-4.0, retrieved 2023-11-13)",
  "schema": "https://everloot.app/schema/mcp/get_by_name.json"
}`;

const JS = `// Call one MCP tool over HTTP. Run: node tool.mjs talent_tree class=warrior
const BASE = "https://everloot.app";
const [tool, ...pairs] = process.argv.slice(2);
const query = new URLSearchParams(pairs.map((pair) => pair.split(/=(.*)/s).slice(0, 2)));

const res = await fetch(\`\${BASE}/api/tools/\${tool}?\${query}\`);
const body = await res.json();

if (res.status === 429) {
  console.error(\`Rate limited. Try again in \${res.headers.get("retry-after")} seconds.\`);
  process.exit(1);
}
if (!res.ok) {
  // 400 says which argument is wrong; 404 lists the tools.
  console.error(\`\${res.status}: \${body.error}\`);
  process.exit(1);
}

console.log(body.text);               // the answer as words
console.log(Object.keys(body.answer)); // the structured answer, in body.answer`;
const PY = `"""Call one MCP tool over HTTP. Run: python tool.py talent_tree class=warrior"""
import json
import sys
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import urlopen

sys.stdout.reconfigure(encoding="utf-8")  # the text can hold characters a Windows console does not
BASE = "https://everloot.app"
tool, *pairs = sys.argv[1:]
query = urlencode([tuple(pair.split("=", 1)) for pair in pairs])

try:
    with urlopen(f"{BASE}/api/tools/{tool}?{query}", timeout=30) as res:
        body = json.load(res)
except HTTPError as err:
    if err.code == 429:
        raise SystemExit(f"Rate limited. Try again in {err.headers['Retry-After']} seconds.")
    # 400 says which argument is wrong; 404 lists the tools.
    raise SystemExit(f"{err.code}: {json.load(err)['error']}")

print(body["text"])             # the answer as words
print(list(body["answer"]))     # the structured answer, in body["answer"]`;
const RUN_JS = `node tool.mjs get_by_name name=Thrall`;
const RUN_PY = `python tool.py get_by_name name=Thrall`;
const OUT_JS = `[lore_page/lore] Thrall
Thrall (birthname Go'el), son of Durotan and Draka, is the former Warchief of the restored shamanistic Horde, founder of the nation of Durotar in Kalimdor and o…
Source: https://warcraft.wiki.gg/wiki/Thrall (CC-BY-SA-4.0, retrieved 2023-11-13)
[ 'hits' ]`;
const OUT_PY = `[lore_page/lore] Thrall
Thrall (birthname Go'el), son of Durotan and Draka, is the former Warchief of the restored shamanistic Horde, founder of the nation of Durotar in Kalimdor and o…
Source: https://warcraft.wiki.gg/wiki/Thrall (CC-BY-SA-4.0, retrieved 2023-11-13)
['hits']`;

const BAD_CMD = `curl -s -w "\\n%{http_code}\\n" "https://everloot.app/api/tools/get_by_name?kind=npc"`;
const BAD_OUT = `{"ok":false,"error":"name: Invalid input: expected string, received undefined. The parameters are described at https://everloot.app/schema/mcp/get_by_name.json."}
400`;
const BAD_ENUM = `{"ok":false,"error":"kind: Invalid option: expected one of \\"item\\"|\\"npc\\"|\\"object\\"|\\"quest\\"|\\"zone\\"|\\"spell\\"|\\"lore_page\\"|\\"creator\\"|\\"realm\\". The parameters are described at https://everloot.app/schema/mcp/get_by_name.json."}
400`;
const NOTOOL_OUT = `{"ok":false,"error":"No tool named nope. Tools: search_knowledge, get_entity, get_by_name, search, fetch, answer_sources, profession_path, recipe_thresholds, item_page, npc_page, object_page, quest_page, vendor_page, world_map_near, entity_relations, item_categories, talent_tree, talent_plan, class_races, collection_gap, completion_progress, guild_board, auction_history, market_value, gold_ledger, population, recent_changes, ecosystem_projects, everloot_plan."}
404`;
const LIMIT_OUT = `HTTP/1.1 429 Too Many Requests
Cache-Control: no-store
Content-Type: application/json
Retry-After: 2758

{"ok":false,"error":"Without a key this endpoint answers 30 requests per hour per address. Try again in 2758 seconds, or get a free key at https://everloot.app/docs/api/keys and send it as \\"Authorization: Bearer <key>\\".","getAKey":"https://everloot.app/docs/api/keys"}`;

export default function Page() {
  return (
    <DocPage href="/docs/cookbook/tools-over-http">
      <Callout kind="tip">
        <p><strong>Goal.</strong> Call an Everloot MCP tool from your own code, with no MCP client.</p>
        <p><strong>Outcome.</strong> You find a tool&apos;s parameters, call it with curl, JavaScript and Python, read the answer, and handle a 400, a 404 and a 429.</p>
      </Callout>

      <H2 id="prerequisites">Prerequisites</H2>
      <List>
        <li>curl, Node 18 or newer, or Python 3 with only its standard library. The curl examples also use <C>jq</C> to pick fields; leave it off to see the whole answer.</li>
        <li>No account. Every MCP tool answers <C>GET /api/tools/&#123;tool&#125;</C>, with the tool&apos;s arguments as query parameters.</li>
        <li>Without a key, this endpoint allows 30 requests an hour for each IP address, shared with the corpus, drop list, items and edges endpoints. The MCP server has its own allowance of 200. <Link href="/docs/api/keys" className={docLink}>Limits and keys</Link> covers the free key.</li>
      </List>

      <H2 id="steps">Steps</H2>
      <Steps>
        <Step title="Find the tool's parameters" id="schema">
          <p className="mt-2 leading-7 text-fg-2">Each tool has a schema file at <C>/schema/mcp/&lt;tool&gt;.json</C>. Its <C>inputSchema</C> lists the parameters, which are required, and the allowed values. Its <C>outputSchema</C> describes the answer. The tool names are listed on the <Link href="/docs/mcp" className={docLink}>MCP overview</Link>.</p>
          <div className="mt-6"><CodeGroup title="Read a schema" tabs={[{ label: "curl", lang: "bash", code: SCHEMA_CMD }, { label: "Output", lang: "json", code: SCHEMA_OUT }]} /></div>
          <p className="mt-4 leading-7 text-fg-2">So <C>get_by_name</C> needs a <C>name</C>, and takes an optional <C>kind</C> from the list shown. Numbers and booleans go in the query string as plain text, such as <C>itemId=19019</C> or <C>true</C> and <C>false</C>.</p>
        </Step>
        <Step title="Call it with curl" id="curl">
          <div className="mt-6"><CodeGroup title="Call get_by_name" tabs={[{ label: "curl", lang: "bash", code: CURL_CMD }, { label: "Output", lang: "json", code: CURL_OUT }]} /></div>
          <p className="mt-4 leading-7 text-fg-2">The answer has five fields. <C>tool</C> and <C>arguments</C> repeat what you asked, with defaults applied. <C>answer</C> is the tool&apos;s structured result, in the shape its <C>outputSchema</C> declares. <C>text</C> is the same answer as words, as an MCP client sees it. <C>schema</C> is the address of the schema file. The <C>jq</C> filter leaves <C>answer</C> out to keep this short; it holds the hits.</p>
        </Step>
        <Step title="Call it from JavaScript or Python" id="script">
          <p className="mt-2 leading-7 text-fg-2">This script takes a tool name and <C>name=value</C> pairs, so it works for any tool. It prints the words, then the keys of the structured answer. Errors go to standard error and the script exits with 1.</p>
          <div className="mt-6"><CodeGroup title="tool" tabs={[{ label: "JavaScript", lang: "js", code: JS }, { label: "Python", lang: "python", code: PY }]} /></div>
          <div className="mt-6"><CodeGroup title="Run" tabs={[{ label: "JavaScript", lang: "bash", code: RUN_JS }, { label: "Python", lang: "bash", code: RUN_PY }]} /></div>
          <div className="mt-6"><CodeGroup title="Output" tabs={[{ label: "JavaScript", lang: "text", code: OUT_JS }, { label: "Python", lang: "text", code: OUT_PY }]} /></div>
        </Step>
        <Step title="Handle a 400" id="400">
          <p className="mt-2 leading-7 text-fg-2">A wrong or missing parameter is a 400, and <C>error</C> says which one and where its schema is.</p>
          <div className="mt-6"><CodeGroup title="A missing and a wrong argument" tabs={[{ label: "Missing", lang: "bash", code: BAD_CMD }, { label: "Output", lang: "text", code: BAD_OUT }, { label: "Wrong value", lang: "text", code: BAD_ENUM }]} /></div>
        </Step>
        <Step title="Handle a 404" id="404">
          <p className="mt-2 leading-7 text-fg-2">An unknown tool name is a 404, and the error lists every tool.</p>
          <div className="mt-6"><CodeGroup title="curl https://everloot.app/api/tools/nope" tabs={[{ label: "Output", lang: "text", code: NOTOOL_OUT }]} /></div>
        </Step>
        <Step title="Handle a 429" id="429">
          <p className="mt-2 leading-7 text-fg-2">Over the limit, the answer is a 429. The <C>Retry-After</C> header says how many seconds to wait, and the body says where to get a free key. The scripts above print the wait and stop. Do not retry before it is over. A key sent as <C>Authorization: Bearer &lt;key&gt;</C> raises the limit.</p>
          <div className="mt-6"><CodeGroup title="A 429" tabs={[{ label: "Output", lang: "text", code: LIMIT_OUT }]} /></div>
        </Step>
      </Steps>

      <H2 id="status">What each status means</H2>
      <Table
        head={["Status", "Meaning", "What to do"]}
        rows={[
          [<C key="200">200</C>, "The tool answered.", "Read answer or text."],
          [<C key="400">400</C>, "An argument is missing or wrong. error says which.", "Fix it from the schema file."],
          [<C key="404">404</C>, "No tool by that name. error lists them.", "Pick a name from the list."],
          [<C key="429">429</C>, "Over the hourly limit.", "Wait Retry-After seconds, or use a free key."],
          [<C key="503">503</C>, "The data could not be read. The answer is unrecorded, not zero.", "Try again later."],
        ]}
      />

      <H2 id="check">Check your work</H2>
      <List>
        <li>The curl call returns a JSON object with <C>tool</C>, <C>arguments</C>, <C>answer</C>, <C>text</C> and <C>schema</C>, and <C>arguments</C> echoes what you sent.</li>
        <li>The JavaScript and Python scripts print the same text as curl.</li>
        <li>Leaving out <C>name</C> gives the 400 above. A made-up tool name gives the 404.</li>
        <li>Answers built on player uploads carry the credit line, in the text and in the <C>X-Everloot-Credit</C> header. Show it if you publish them.</li>
      </List>
      <P>A tool that reads player uploads can answer with &quot;unrecorded&quot;, in the text and in the structured answer. That is an answer, not an error. It means players have not reported enough yet.</P>

      <H2 id="next-steps">Next steps</H2>
      <List>
        <li><Link href="/docs/api/tools" className={docLink}>/tools/&#123;tool&#125;</Link>: the endpoint reference.</li>
        <li><Link href="/docs/mcp" className={docLink}>MCP overview</Link>: every tool, with its own page.</li>
        <li><Link href="/docs/cookbook/ask-claude" className={docLink}>Ask Claude about WoW: Forever</Link>: use the same tools in a chat.</li>
      </List>
    </DocPage>
  );
}
