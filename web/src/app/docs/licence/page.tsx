import type { Metadata } from "next";
import Link from "next/link";
import { CREDIT_LINE, LICENCE, LICENCE_URL, TERMS_URL } from "@everloot/protocol";
import { C, H2, List, P, docLink } from "@/components/docs/blocks";
import { CodeGroup } from "@/components/docs/DocsClient";
import DocPage from "@/components/docs/DocPage";
import { pageMetadata } from "@/lib/seo";
import { REPO_URL } from "@/lib/source";

export const metadata: Metadata = pageMetadata({
  title: "Licence and Credit",
  description: "What you may do with Everloot's data and code: CC BY-SA 4.0 data with a credit line, AGPL-3.0 code, and what belongs to Blizzard and others.",
  path: "/docs/licence",
});

const creditHtml = `<a href="https://everloot.app">Data from Everloot</a>, <a href="${LICENCE_URL}">${LICENCE}</a>.`;

export default function Page() {
  return (
    <DocPage href="/docs/licence">
      <P>
        Everloot&apos;s data is open. You may reuse it with credit. This page says what is under which licence. The binding text
        is in the <a href={TERMS_URL} className={docLink}>terms</a>.
      </P>

      <H2 id="data">Data: {LICENCE}</H2>
      <P>
        Observations uploaded by players, and the facts derived from them, are <a href={LICENCE_URL} rel="noopener" className={docLink}>{LICENCE}</a>,
        credited to Everloot contributors. You may reuse them with credit, and what you build from them stays under the same
        licence. Republishing the data without the credit breaks the licence.
      </P>
      <P>
        Our own words on the pages are under the same licence unless a page says otherwise.
      </P>

      <H2 id="credit-line">The credit line</H2>
      <P>Link it wherever the data appears.</P>
      <div className="mt-6">
        <CodeGroup
          title="Credit line"
          tabs={[
            { label: "Text", lang: "text", code: CREDIT_LINE },
            { label: "HTML", lang: "html", code: creditHtml },
          ]}
        />
      </div>
      <P>
        Every answer carries it, so it is hard to lose by accident. The JSON APIs have an <C>attribution</C> field with the
        licence, the credit line and the page the data comes from, and send the same in the <C>X-Everloot-Licence</C>,{" "}
        <C>X-Everloot-Credit</C> and <C>Link</C> headers, MCP responses included. An MCP answer links the everloot.app page
        it comes from, and that link is its credit.
      </P>

      <H2 id="code">Code: AGPL-3.0</H2>
      <P>
        The site, the addon, the Desktop App and the knowledge base are AGPL-3.0-only. The{" "}
        <a href={REPO_URL} rel="noopener" className={docLink}>source is public</a>. Layout and design are part of the code.
      </P>

      <H2 id="lore">Lore</H2>
      <P>
        Lore text comes from the Warcraft Wiki dump of 13 November 2023 and keeps its own licence, CC BY-SA 4.0. Every MCP hit
        carries its source URL and licence. Keep them with the text, and credit the Warcraft Wiki if you show it.
      </P>

      <H2 id="blizzard">Blizzard&apos;s art, text and game data</H2>
      <P>
        World of Warcraft and its game data belong to Blizzard Entertainment. Anything read from the game files is shown as facts
        with the build it came from, labelled unconfirmed until seen in play, and is not under Everloot&apos;s licences.
      </P>
      <List>
        <li>Downloads, the API and the MCP server carry ids and facts. They do not carry Blizzard&apos;s icons, tooltip text or art in bulk.</li>
        <li>Some pages, and a tooltip card for one item, show Blizzard&apos;s icons and tooltip text. They are credited to Blizzard and stay Blizzard&apos;s.</li>
        <li>If you want Blizzard&apos;s art in your own project, take it from the game client yourself.</li>
      </List>
      <P>
        Everloot is a fan project and is not affiliated with or endorsed by Blizzard.
      </P>

      <H2 id="table-names">Table names</H2>
      <P>
        Where a page or file shows column names from game tables, they come from{" "}
        <a href="https://github.com/wowdev/WoWDBDefs" rel="noopener" className={docLink}>WoWDBDefs</a> by the wowdev
        contributors, CC BY-SA 4.0.
      </P>

      <H2 id="name-and-logo">Name and logo</H2>
      <P>
        The Everloot name and logo are not licensed. You may say your project uses Everloot data, links to it or works with it,
        but give it its own name, and do not make it look official. Details are in{" "}
        <a href={`${REPO_URL}/blob/main/TRADEMARKS.md`} rel="noopener" className={docLink}>TRADEMARKS.md</a>.
      </P>

      <H2 id="more">More</H2>
      <P>
        Where the data comes from and what we refuse to use:{" "}
        <a href={`${REPO_URL}/blob/main/docs/DATA_POLICY.md`} rel="noopener" className={docLink}>DATA_POLICY.md</a>. Every
        third-party source and licence:{" "}
        <a href={`${REPO_URL}/blob/main/THIRD_PARTY.md`} rel="noopener" className={docLink}>THIRD_PARTY.md</a>. To ask for
        something to be removed, see <Link href="/terms#takedown" className={docLink}>Copyright and takedown</Link>.
      </P>
    </DocPage>
  );
}
