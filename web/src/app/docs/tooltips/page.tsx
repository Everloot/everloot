import { CLASSES, QUALITIES, tokens } from "@/design/tokens";
import type { Metadata } from "next";
import Script from "next/script";
import Link from "next/link";
import { SITE } from "@everloot/protocol";
import { Callout, C, H2, List, P, Table, docLink } from "@/components/docs/blocks";
import { CodeGroup } from "@/components/docs/DocsClient";
import DocPage from "@/components/docs/DocPage";
import { CONNECT_EXAMPLES as ex } from "@/lib/docs/connect-data";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Embeddable Tooltips for WoW Forever",
  description: "Add one script tag and every link to an Everloot item, NPC, quest or object page shows a game-style card on hover. No cookies, no tracking.",
  path: "/docs/tooltips",
});

export default function Page() {
  return (
    <DocPage href="/docs/tooltips">
      <P>
        Add one line to your blog, guild site or forum theme and every link to an Everloot item, NPC, quest or object page
        shows a game-style card on hover.
      </P>

      <H2 id="add-the-script">Add the script</H2>
      <P>Put this in your page, once.</P>
      <div className="mt-6">
        <CodeGroup title="Load the Everloot tooltip script" tabs={[{ label: "HTML", lang: "html", code: ex.tooltipScript }]} />
      </div>

      <H2 id="link">Link as you normally would</H2>
      <P>Nothing else to configure. Links added to the page later are picked up too.</P>
      <div className="mt-6">
        <CodeGroup title="A link that gets a tooltip" tabs={[{ label: "HTML", lang: "html", code: ex.tooltipLink }]} />
      </div>
      <P>
        Live example, with the script loaded on this page:{" "}
        <a href={`${SITE}/database/items/19019`} className={docLink}>Thunderfury</a>,{" "}
        <a href={`${SITE}/database/npcs/6`} className={docLink}>an NPC</a> and{" "}
        <a href={`${SITE}/database/quests/9`} className={docLink}>a quest</a>. A card appears only for pages players have
        reported, so a link to an id nobody has seen shows no card and just works as a link.
      </P>
      <Callout kind="note">
        <p>
          Reports start with WoW: Forever&apos;s launch on 4 November 2026. Until players have reported these pages, the card request answers{" "}
          <C>404</C> and the three links above show no card. They start to work as players upload and 3 installs agree.
        </p>
      </Callout>

      <H2 id="how-it-behaves">How it behaves</H2>
      <List>
        <li>Hover or keyboard focus shows the card; Escape closes it. On a touch screen the first tap shows it and the second follows the link.</li>
        <li>The script is under 8 KB, has no dependencies, and draws the card in an isolated container, so your page&apos;s styles cannot break it. It respects <C>prefers-reduced-motion</C>.</li>
        <li>No cookies and no tracking. Each hovered link makes one request to everloot.app, sent without cookies or a referrer.</li>
        <li>To skip a link, add <C>data-everloot-tooltip=&quot;off&quot;</C>.</li>
      </List>

      <H2 id="what-a-card-shows">What a card shows</H2>
      <P>
        A card carries one item&apos;s game icon and tooltip facts, the same ones its page shows. Cards follow the site&apos;s rules:
        a fact appears once 3 installs reported it, and anything that comes from the game files is labelled{" "}
        <em>found in game files, unconfirmed</em>, with its build. See <Link href="/docs/how-it-works" className={docLink}>How Everloot works</Link>.
      </P>
      <Callout kind="note">
        <p>Game icons and tooltip text are Blizzard&apos;s. The card credits them: &quot;Icons, tooltip text and interface art are &copy; Blizzard Entertainment, Inc. Everloot is a fan project and is not affiliated with or endorsed by Blizzard.&quot; They stay outside Everloot&apos;s licence, and they are not in the bulk downloads, the rest of the API or the MCP server.</p>
      </Callout>

      <H2 id="colours-and-icons">Colours and icons</H2>
      <P>The tooltip frame stays dark in both themes; item names and their 1px icon borders use quality colours, while character names use class colours.</P>
      <Table head={["Class", "Light", "Dark"]} rows={CLASSES.map((name) => [name[0].toUpperCase() + name.slice(1), tokens.light[`class-${name}`], tokens.dark[`class-${name}`]])} />
      <Table head={["Quality", "Light", "Dark"]} rows={QUALITIES.map((name) => [name[0].toUpperCase() + name.slice(1), tokens.light[`q-${name}`], tokens.dark[`q-${name}`]])} />

      <H2 id="the-endpoint">The endpoint behind it</H2>
      <P>
        The data is <C>GET /api/tooltip/&#123;type&#125;/&#123;id&#125;</C>, where type is item, npc, quest or object. It returns one page per
        request. It is open to any website (CORS for GET), and the CDN keeps each answer for an hour, so it needs no key. It is
        meant for cards, not for copying data: for that, use the corpus API. Parameters and the answer shape are on{" "}
        <Link href="/docs/api/tooltip" className={docLink}>/tooltip</Link>.
      </P>
      <div className="mt-6">
        <CodeGroup title="Fetch one tooltip" tabs={[{ label: "cURL", lang: "bash", code: ex.tooltipCurl }]} />
      </div>
      <P>
        If the page has not been reported yet, the answer is <C>ok: false</C> and says so.
      </P>

      <Script src="/tooltips.js" strategy="lazyOnload" />
    </DocPage>
  );
}
