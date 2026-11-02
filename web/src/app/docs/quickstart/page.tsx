import type { Metadata } from "next";
import Link from "next/link";
import { CREDIT_LINE, SITE } from "@everloot/protocol";
import { Callout, C, Cards, H2, LinkCard, P, Table, docLink } from "@/components/docs/blocks";
import { CodeGroup } from "@/components/docs/DocsClient";
import DocPage from "@/components/docs/DocPage";
import { CONNECT_EXAMPLES as ex } from "@/lib/docs/connect-data";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Everloot Quickstart",
  description: "Three ways into Everloot: browse the site, install the addon, or use the open data through the API, the MCP server and embeddable tooltips.",
  path: "/docs/quickstart",
});

const apiCurl = `curl -s "${SITE}/api/tools/get_by_name?name=Thrall"`;

const apiJs = `const res = await fetch("${SITE}/api/tools/get_by_name?name=Thrall");
const body = await res.json();
for (const hit of body.answer.hits) {
  console.log(hit.name, hit.sourceUrl, hit.licence);
}`;

const apiPy = `import requests

body = requests.get(
    "${SITE}/api/tools/get_by_name",
    params={"name": "Thrall"},
    timeout=30,
).json()
for hit in body["answer"]["hits"]:
    print(hit["name"], hit["sourceUrl"], hit["licence"])`;

export default function Page() {
  return (
    <DocPage href="/docs/quickstart">
      <P>
        You can use Everloot without an account and without a key. Pick the way in that matches what you want to do. Each one
        takes a few minutes.
      </P>

      <Table
        head={["Approach", "Best for"]}
        rows={[
          [<a key="w" href="#website" className={docLink}>Website</a>, "Looking things up: items, NPCs, quests, zones, the map and the tools."],
          [<a key="a" href="#addon" className={docLink}>Addon</a>, "Playing WoW: Forever and sharing what you see, so the facts get filled in."],
          [<a key="p" href="#api" className={docLink}>API</a>, "Reading the open data from a script, a spreadsheet or your own site."],
          [<a key="m" href="#mcp" className={docLink}>MCP server</a>, "Giving Claude, ChatGPT or another assistant Everloot's data, with sources."],
          [<a key="t" href="#tooltips" className={docLink}>Tooltips</a>, "Showing a game-style card when someone hovers a link to Everloot on your site."],
        ]}
      />

      <H2 id="website">Website</H2>
      <P>
        Open <a href={SITE} className={docLink}>everloot.app</a> and search. Nothing to install. The{" "}
        <Link href="/database" className={docLink}>database</Link>, the <Link href="/map" className={docLink}>map</Link> and the{" "}
        <Link href="/tools/talents" className={docLink}>talent calculator</Link> are open to everyone. A fact shows up once three
        installs agree on it; until then the page says it is not recorded yet.
      </P>
      <P>
        <Link href="/docs/guides/find" className={docLink}>Find things on the site</Link> shows where each page lives.
      </P>

      <H2 id="addon">Addon</H2>
      <P>
        The addon records what you see while you play and saves it to a file on your computer. You choose when to upload it.
        You can <Link href="/addon" className={docLink}>download it here</Link>. Once it is in your AddOns folder, check it is running:
      </P>
      <div className="mt-6">
        <CodeGroup title="Check it is running" tabs={[{ label: "In game", lang: "text", code: "/everloot status" }]} />
      </div>
      <P>
        Then log out and pick <C>Everloot.lua</C> on the <Link href="/upload" className={docLink}>upload page</Link>, which shows
        you everything before it is sent. Step by step: <Link href="/docs/guides/addon" className={docLink}>Install the addon</Link>{" "}
        and <Link href="/docs/guides/upload" className={docLink}>Upload your data</Link>.
      </P>

      <H2 id="api">API</H2>
      <P>
        The API is JSON over HTTPS. Reading needs no key, but without one the API answers a limited number of requests an
        hour for each address; <Link href="/docs/api/keys" className={docLink}>Limits and keys</Link> has the numbers. This
        call looks up a name and returns the records that match, each with its source and licence.
      </P>
      <div className="mt-6">
        <CodeGroup
          title="Your first request"
          tabs={[
            { label: "cURL", lang: "bash", code: apiCurl },
            { label: "JavaScript", lang: "js", code: apiJs },
            { label: "Python", lang: "python", code: apiPy },
          ]}
        />
      </div>
      <P>
        The answer holds <C>answer.hits</C>, and <C>text</C> with the same words in plain text. To read what players have
        uploaded, use the corpus endpoint:
      </P>
      <div className="mt-6">
        <CodeGroup title="Public player records" tabs={[{ label: "cURL", lang: "bash", code: ex.corpusCurl }]} />
      </div>
      <Callout kind="note">
        <p>The corpus only holds what players have uploaded and made public, so a young database may return few or no records. Every answer says when its data was current in <C>dataAsOf</C>.</p>
      </Callout>
      <Callout kind="warning">
        <p>Data from player uploads is CC BY-SA 4.0. Keep the credit line with it: {CREDIT_LINE} The <Link href="/docs/licence" className={docLink}>licence page</Link> has the rest.</p>
      </Callout>

      <H2 id="mcp">MCP server</H2>
      <P>
        The hosted server needs no sign-in. In Claude Code, add it with one command. Other clients that speak streamable HTTP
        take the same URL in their config.
      </P>
      <div className="mt-6">
        <CodeGroup
          title="Connect the MCP server"
          tabs={[
            { label: "Claude Code", lang: "bash", code: ex.claudeCode },
            { label: "Generic config", lang: "json", code: ex.remoteConfig },
          ]}
        />
      </div>
      <P>
        For Claude.ai, Claude Desktop, ChatGPT and Grok, see <Link href="/docs/mcp/clients" className={docLink}>Connect a client</Link>.
      </P>

      <H2 id="tooltips">Tooltips</H2>
      <P>
        Add one script tag to your page. Every link to an Everloot item, NPC, quest or object page then shows a card on hover.
      </P>
      <div className="mt-6">
        <CodeGroup
          title="Add tooltips to a page"
          tabs={[
            { label: "Script tag", lang: "html", code: ex.tooltipScript },
            { label: "A link", lang: "html", code: ex.tooltipLink },
          ]}
        />
      </div>
      <P>
        A card shows only for a page players have reported, once 3 installs agree. Reports start with WoW: Forever&apos;s
        launch on 4 November 2026. Until then a link gets no card and works as a plain link. More on{" "}
        <Link href="/docs/tooltips" className={docLink}>Embeddable tooltips</Link>.
      </P>

      <H2 id="next">Next steps</H2>
      <Cards>
        <LinkCard href="/docs/how-it-works" title="How Everloot works" icon="compass">Why a fact needs three installs, and what unconfirmed means.</LinkCard>
        <LinkCard href="/docs/api" title="API Reference" icon="code">Every endpoint, parameter and answer.</LinkCard>
        <LinkCard href="/docs/mcp" title="MCP server" icon="plug">The tools an assistant can call.</LinkCard>
        <LinkCard href="/docs/licence" title="Licence and credit" icon="scale">What you may do with the data.</LinkCard>
      </Cards>
    </DocPage>
  );
}
