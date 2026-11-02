import type { Metadata } from "next";
import { Callout, C, H2, List, P, Step, Steps, Table, docLink } from "@/components/docs/blocks";
import { CodeGroup } from "@/components/docs/DocsClient";
import DocPage from "@/components/docs/DocPage";
import { CONNECT_EXAMPLES as ex, MCP_URL } from "@/lib/docs/connect-data";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";

export const metadata: Metadata = pageMetadata({
  title: "Ask Claude about WoW: Forever",
  description: "Connect Everloot to Claude.ai or Claude Code, with no sign-in or key, then ask questions about WoW: Forever and get answers with their sources.",
  path: "/docs/cookbook/ask-claude",
});

const CLAUDE_CODE = ex.claudeCode;

const CHECK_CODE = `claude mcp list`;

const CURL = ex.mcpCurl;

const CURL_OUT = `{"result":{"content":[{"type":"text","text":"[lore_page/lore] Thrall\\nThrall (birthname Go'el), son of Durotan and Draka, is the former Warchief of the restored shamanistic Horde, founder of the nation of Durotar in Kalimdor and o…\\nSource: https://warcraft.wiki.gg/wiki/Thrall (CC-BY-SA-4.0, retrieved 2023-11-13)"}],"structuredContent":{"hits":[…]}}, …}`;

export default function Page() {
  return (
    <DocPage href="/docs/cookbook/ask-claude">
      <Callout kind="tip">
        <p><strong>Goal.</strong> Let Claude look things up in Everloot, so its answers come with a source.</p>
        <p><strong>Outcome.</strong> Everloot connected to Claude.ai or Claude Code, and six questions it can answer today.</p>
      </Callout>

      <H2 id="prerequisites">Prerequisites</H2>
      <List>
        <li>Claude.ai or Claude Desktop on any plan, including Free, or Claude Code installed.</li>
        <li>The Everloot address: <C>{MCP_URL}</C>. It needs no sign-in and no key.</li>
      </List>

      <H2 id="steps">Steps</H2>
      <Steps>
        <Step title="Connect it in Claude.ai" id="claude-ai">
          <p className="mt-2 leading-7 text-fg-2">Open <a href="https://claude.ai/customize/connectors" rel="noopener" className={docLink}>Customize, then Connectors</a>, add a connector by URL and paste the address above. When it shows <em>Connected</em>, open a chat, turn Everloot on from the plus menu under Connectors, and ask your question.</p>
        </Step>
        <Step title="Or connect it in Claude Code" id="claude-code">
          <p className="mt-2 leading-7 text-fg-2">Run this once in a terminal, then start <C>claude</C> as usual.</p>
          <div className="mt-6"><CodeGroup title="Add the server" tabs={[{ label: "Terminal", lang: "bash", code: CLAUDE_CODE }, { label: "Check", lang: "bash", code: CHECK_CODE }]} /></div>
          <p className="mt-4 leading-7 text-fg-2"><C>claude mcp list</C> prints one line per server with its address and state. Look for <C>everloot</C> marked Connected.</p>
        </Step>
        <Step title="Ask a question" id="ask">
          <p className="mt-2 leading-7 text-fg-2">Say Everloot in the question, so Claude knows where to look. These all have answers today. Each one is run through the tool named beside it.</p>
          <Table
            head={["Ask", "Tool", "You get"]}
            rows={[
              [<>&quot;Using Everloot, who is Thrall?&quot;</>, <C key="a">answer_sources</C>, "Passages from the Warcraft Wiki, each with its page, licence and retrieval date."],
              [<>&quot;What has Blizzard posted about WoW: Forever lately?&quot;</>, <C key="b">recent_changes</C>, "Recent staff posts and new game builds, newest first, with links to the originals."],
              [<>&quot;Show me the Warrior talent trees from Everloot.&quot;</>, <C key="c">talent_tree</C>, "Arms, Fury and Protection, with their nodes, from the game files. Labelled unconfirmed, with the build."],
              [<>&quot;Which item classes and subclasses exist in the game files?&quot;</>, <C key="d">item_categories</C>, "The class tree with item counts, labelled unconfirmed, with the build."],
              [<>&quot;Which addons and projects are there for WoW: Forever?&quot;</>, <C key="e">ecosystem_projects</C>, "Addons and open-source projects with their repositories."],
              [<>&quot;What is Everloot building next?&quot;</>, <C key="f">everloot_plan</C>, "What is live, what is next and what is waiting."],
            ]}
          />
        </Step>
        <Step title="Look at the raw answer (optional)" id="raw">
          <p className="mt-2 leading-7 text-fg-2">To see what Claude receives, call a tool yourself. The server keeps no session, so one request is enough, and the <C>accept</C> header must list both types.</p>
          <div className="mt-6"><CodeGroup title="Call get_by_name" tabs={[{ label: "curl", lang: "bash", code: CURL }, { label: "Output, trimmed", lang: "text", code: CURL_OUT }]} /></div>
        </Step>
      </Steps>

      <Callout kind="note">
        <p>Questions about drop rates, prices, vendors and quest details are answered only from what players have uploaded since WoW: Forever launched on 4 November 2026. Where too little has been uploaded, the tools answer &quot;unrecorded&quot; instead of a number, and Claude relays that. These questions start to work as players report and three installs agree.</p>
      </Callout>

      <H2 id="check">Check your work</H2>
      <List>
        <li>In Claude.ai, the connector shows Connected and is switched on in the chat. In Claude Code, <C>claude mcp list</C> shows <C>everloot</C> as Connected.</li>
        <li>For the Thrall question, the reply cites a Warcraft Wiki page and says it is CC BY-SA 4.0.</li>
        <li>Claude shows that it used an Everloot tool. If it answered from memory with no tool call, repeat the question and start it with &quot;Using Everloot&quot;.</li>
        <li>Answers built on player uploads end with the Everloot credit line. Keep it if you share them.</li>
      </List>
      <P>The public server answers 200 requests an hour for each IP address. Past that, the server answers with a 429 until the hour has passed.</P>

      <H2 id="next-steps">Next steps</H2>
      <List>
        <li><Link href="/docs/mcp/clients" className={docLink}>Connect a client</Link>: ChatGPT, Grok and other clients.</li>
        <li><Link href="/docs/mcp" className={docLink}>MCP overview</Link>: every tool and what it needs.</li>
        <li><Link href="/docs/cookbook/tools-over-http" className={docLink}>MCP tools over plain HTTP</Link>: the same tools, without Claude.</li>
      </List>
    </DocPage>
  );
}
