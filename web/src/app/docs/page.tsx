import type { Metadata } from "next";
import { Callout, Cards, H2, LinkCard, P, docLink } from "@/components/docs/blocks";
import DocPage from "@/components/docs/DocPage";
import { LegacyAnchors } from "@/components/docs/DocsClient";
import { legacyAnchors } from "@/lib/docs/nav";
import { pageMetadata } from "@/lib/seo";
import Link from "@/components/Link";

export const metadata: Metadata = pageMetadata({
  title: "WoW Forever Docs: Addon, API and MCP Server",
  description: "Install the Everloot addon, upload what you see in WoW: Forever, and build on the open data with the API, the MCP server and embeddable tooltips.",
  path: "/docs",
});

export default function DocsHome() {
  return (
    <DocPage href="/docs" title="Everloot Docs" lede="Everything about Everloot in one place: how to play with it, and how to build on it.">
      <LegacyAnchors targets={legacyAnchors()} />
      <P>
        Everloot is a community database for World of Warcraft: Forever. Players run a small addon that notes what they
        see in game, upload it, and once three installs agree on something it becomes a fact on the site. All of it is
        open: you can read it in the browser, ask an AI assistant about it, or build on it with the API.
      </P>

      <H2 id="players">If you play</H2>
      <Cards>
        <LinkCard href="/docs/guides/addon" title="Install the addon" icon="rocket">Get Everloot into the game and check it is running.</LinkCard>
        <LinkCard href="/docs/guides/desktop" title="The Desktop App" icon="monitor">Upload after every logout and get prices in your tooltips.</LinkCard>
        <LinkCard href="/docs/guides/upload" title="Upload your data" icon="upload">Share what you saw, from the browser or the Desktop App.</LinkCard>
        <LinkCard href="/docs/guides/find" title="Find things on the site" icon="search">Search, the database, zone pages and the world map.</LinkCard>
        <LinkCard href="/docs/guides/privacy" title="Privacy and your data" icon="shield">What an upload carries and what is published.</LinkCard>
        <LinkCard href="/docs/guides/account" title="Your account" icon="user">Sign in, and make API keys.</LinkCard>
      </Cards>

      <H2 id="builders">If you build</H2>
      <Cards>
        <LinkCard href="/docs/quickstart" title="Quickstart" icon="rocket">Your first request in under a minute. No account needed.</LinkCard>
        <LinkCard href="/docs/api" title="API Reference" icon="code">Every endpoint, its parameters and its answers.</LinkCard>
        <LinkCard href="/docs/mcp" title="MCP server" icon="plug">Give Claude, ChatGPT or any MCP client Everloot&apos;s data.</LinkCard>
        <LinkCard href="/docs/tooltips" title="Embeddable tooltips" icon="spark">One script tag for game-style hover cards on your site.</LinkCard>
      </Cards>

      <Callout kind="tip">
        <p>New here? <Link href="/docs/how-it-works" className={docLink}>How Everloot works</Link> explains the 3-install rule and what &quot;found in game files, unconfirmed&quot; means. Both come up on every page.</p>
      </Callout>

      <H2 id="more">More</H2>
      <Cards cols={3}>
        <LinkCard href="/docs/cookbook" title="Cookbook" icon="chef">Short, tested walkthroughs.</LinkCard>
        <LinkCard href="/docs/licence" title="Licence and credit" icon="scale">What you may do with the data.</LinkCard>
        <LinkCard href="/docs/faq" title="FAQ" icon="help">Quick answers.</LinkCard>
      </Cards>
    </DocPage>
  );
}
