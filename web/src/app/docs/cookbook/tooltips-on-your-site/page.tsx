import type { Metadata } from "next";
import { Callout, C, H2, List, P, Step, Steps, docLink } from "@/components/docs/blocks";
import { CodeGroup } from "@/components/docs/DocsClient";
import DocPage from "@/components/docs/DocPage";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";

export const metadata: Metadata = pageMetadata({
  title: "Tooltips on your site",
  description: "Add Everloot hover cards to a plain HTML page, a WordPress site or a forum theme with one script tag, and check they work.",
  path: "/docs/cookbook/tooltips-on-your-site",
});

const SCRIPT = `<script src="https://everloot.app/tooltips.js" async></script>`;

const PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Tooltip test</title></head>
<body>
  <p>
    The sword is <a href="https://everloot.app/database/items/19019">Thunderfury</a>,
    and this link is <a href="https://everloot.app/database/items/19019" data-everloot-tooltip="off">left alone</a>.
  </p>
  <script src="https://everloot.app/tooltips.js" async></script>
</body>
</html>`;

const LINKS = `<a href="https://everloot.app/database/items/19019">an item</a>
<a href="https://everloot.app/database/npcs/6">an NPC</a>
<a href="https://everloot.app/database/quests/9">a quest</a>
<a href="https://everloot.app/database/objects/1">an object</a>
<a href="https://everloot.app/database/items/19019-thunderfury">a slug after the id is fine</a>`;

const CURL = `curl -s -w "\\n%{http_code}\\n" https://everloot.app/api/tooltip/item/19019`;

const REPORTED = `{
  "ok": true,
  "type": "item",
  "id": 19019,
  "title": "…",
  "color": "#ff8000",
  "icon": "https://…",
  "lines": ["…"],
  "partial": false,
  "url": "https://everloot.app/database/items/19019",
  "attribution": { "licence": "CC BY-SA 4.0", "credit": "Data from Everloot (https://everloot.app), CC BY-SA 4.0.", "…": "…" },
  "gameData": { "label": "…", "build": "…", "credit": "…" }
}
200`;

const UNREPORTED = `{"ok":false,"error":"Nothing to show: no such page, or players have not reported it yet."}
404`;

export default function Page() {
  return (
    <DocPage href="/docs/cookbook/tooltips-on-your-site">
      <Callout kind="tip">
        <p><strong>Goal.</strong> Links from your site to Everloot item, NPC, quest and object pages show a game-style card on hover.</p>
        <p><strong>Outcome.</strong> One script tag working on a plain page, a WordPress site and a forum theme, and a way to tell whether it is working.</p>
      </Callout>

      <H2 id="prerequisites">Prerequisites</H2>
      <List>
        <li>A page where you can edit the HTML, or a site where you can add a script to the footer.</li>
        <li>Links to Everloot pages. Anything under <C>everloot.app/database/</C> for an item, NPC, quest or object works.</li>
        <li>No account and no key. The script and the data behind it are open.</li>
      </List>

      <H2 id="steps">Steps</H2>
      <Steps>
        <Step title="Make a test page" id="test-page">
          <p className="mt-2 leading-7 text-fg-2">Start with a plain HTML file. Save this as <C>tooltip-test.html</C>. The script tag goes just before the closing <C>&lt;/body&gt;</C>. The second link has <C>data-everloot-tooltip=&quot;off&quot;</C>, which tells the script to skip it.</p>
          <div className="mt-6"><CodeGroup title="tooltip-test.html" tabs={[{ label: "HTML", lang: "html", code: PAGE }]} /></div>
          <p className="mt-4 leading-7 text-fg-2">Open the file in your browser and hover the first link. <Link href="#check" className={docLink}>Check your work</Link> says what to expect.</p>
        </Step>
        <Step title="Add it to WordPress" id="wordpress">
          <p className="mt-2 leading-7 text-fg-2">For one post or page, add a <strong>Custom HTML</strong> block and paste the script tag into it. Write your links as normal links, in the editor or in the same block.</p>
          <p className="mt-4 leading-7 text-fg-2">For the whole site, put the same tag in the theme&apos;s footer, just before <C>&lt;/body&gt;</C>. In most themes that is <C>footer.php</C>. If you would rather not edit theme files, a plugin that adds code to the footer does the same job. Use a child theme so a theme update does not remove your change.</p>
          <div className="mt-6"><CodeGroup title="Footer or Custom HTML block" tabs={[{ label: "HTML", lang: "html", code: SCRIPT }]} /></div>
        </Step>
        <Step title="Add it to a forum theme" id="forum">
          <p className="mt-2 leading-7 text-fg-2">Forum software has a place for extra HTML at the end of every page: a footer template, or a &quot;custom code&quot; or &quot;extra scripts&quot; setting in the theme. Paste the same tag there. Members then write ordinary links to Everloot pages in their posts, and the script picks up links added after the page has loaded.</p>
          <p className="mt-4 leading-7 text-fg-2">If your forum sets a Content Security Policy, it has to allow <C>https://everloot.app</C> as a script source and for connections, because the script fetches each card from there.</p>
        </Step>
        <Step title="Choose which links get a card" id="which-links">
          <p className="mt-2 leading-7 text-fg-2">The script looks at the link&apos;s address. These shapes get a card. Everything else, including every link to another site, is ignored.</p>
          <div className="mt-6"><CodeGroup title="Links that match" tabs={[{ label: "HTML", lang: "html", code: LINKS }]} /></div>
          <p className="mt-4 leading-7 text-fg-2">To skip one link, add <C>data-everloot-tooltip=&quot;off&quot;</C> to it.</p>
        </Step>
        <Step title="Check the data for a link" id="check-data">
          <p className="mt-2 leading-7 text-fg-2">A card is built from <C>GET /api/tooltip/&#123;type&#125;/&#123;id&#125;</C>. Ask it for the page you linked to.</p>
          <div className="mt-6"><CodeGroup title="Ask for one card" tabs={[{ label: "curl", lang: "bash", code: CURL }]} /></div>
          <p className="mt-4 leading-7 text-fg-2">When players have reported the page, you get the card as JSON and a 200. The shape, with values trimmed:</p>
          <div className="mt-6"><CodeGroup title="Reported page" tabs={[{ label: "Output", lang: "json", code: REPORTED }]} /></div>
          <p className="mt-4 leading-7 text-fg-2">When nobody has, you get a 404 and the script shows no card:</p>
          <div className="mt-6"><CodeGroup title="Page nobody has reported" tabs={[{ label: "Output", lang: "text", code: UNREPORTED }]} /></div>
        </Step>
      </Steps>

      <Callout kind="note">
        <p>Players report pages from WoW: Forever&apos;s launch on 4 November 2026, and until a page is reported, its card request returns the 404 above. Your links still work as plain links, and cards start to appear as players upload and three installs agree.</p>
      </Callout>

      <H2 id="check">Check your work</H2>
      <List>
        <li>Hover or tab to a link to a reported page: a card appears below it. Press Escape and it closes.</li>
        <li>In your browser&apos;s network tab, hovering a matching link makes one request to <C>everloot.app/api/tooltip/…</C>. A 404 means the page has not been reported. It is not a fault in your setup.</li>
        <li>The link with <C>data-everloot-tooltip=&quot;off&quot;</C> makes no request.</li>
        <li>On a touch screen, the first tap shows the card and the second follows the link.</li>
        <li>If nothing is requested at all, check that the script tag is on the page and that the console shows no Content Security Policy error.</li>
      </List>
      <P>The script sets no cookies, and each request is sent without cookies or a referrer. A card carries the licence, and item cards credit Blizzard for game-file text and icons.</P>

      <H2 id="next-steps">Next steps</H2>
      <List>
        <li><Link href="/docs/tooltips" className={docLink}>Embeddable tooltips</Link>: the full reference.</li>
        <li><Link href="/docs/api/tooltip" className={docLink}>/tooltip/&#123;type&#125;/&#123;id&#125;</Link>: the endpoint and its answer.</li>
        <li><Link href="/docs/licence" className={docLink}>Licence and credit</Link>: what you may do with the data.</li>
      </List>
    </DocPage>
  );
}
