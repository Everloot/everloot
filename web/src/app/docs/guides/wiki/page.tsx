import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { Callout, C, H2, List, P, Table, docLink } from "@/components/docs/blocks";
import { CodeGroup } from "@/components/docs/DocsClient";
import DocPage from "@/components/docs/DocPage";
import { pageMetadata } from "@/lib/seo";

const REPO = "https://github.com/Everloot/everloot";

export const metadata: Metadata = pageMetadata({
  title: "Write a wiki page",
  description: "How a page of the WoW: Forever wiki is proposed and reviewed: the page types and their sections, the front matter, the rules on numbers and sources, the check and the pull request.",
  path: "/docs/guides/wiki",
});

const FRONT_MATTER = `---
id: 7                      # stable, never reused
slug: deadmines            # the file name and the address, /wiki/deadmines
title: Deadmines
type: dungeon              # see "Types and sections"
binds: { entrance: deadmines, zone: 1436 }
summary: One or two sentences in our own words, shown on database pages and in search results.
categories: [dungeons, eastern-kingdoms, westfall]   # from categories.yaml
origin: original           # or adapted
adaptedFrom: []            # adapted pages: [{ title, url, extId, revision }] of each Warcraft Wiki page reused
sources: []                # [{ title, url, checkedOn }]: Blizzard posts and other evidence, for review, not printed
status: draft              # draft pages are not built on the site
reviewed: null             # published pages: { by: <maintainer>, on: YYYY-MM-DD }
---`;

export default function Page() {
  return (
    <DocPage href="/docs/guides/wiki">
      <Callout kind="note">
        <p>
          This page follows the README in the repository&apos;s{" "}
          <a href={`${REPO}/tree/main/kb/wiki`} className={docLink}>kb/wiki</a> folder, which is the authoritative
          text. If they differ, the README wins.
        </p>
      </Callout>

      <H2 id="what">What a wiki page is</H2>
      <P>
        Each page is a short piece of writing in Everloot&apos;s own words wrapped around live data. The writing says what
        a thing is and why it matters in WoW: Forever. Everything countable (levels, bosses, drops, positions, player
        limits) comes from the game files or from player uploads and fills in by itself; an editor never types it.
      </P>
      <P>
        The pages are content, not code: they are under CC BY-SA 4.0, the same licence as the rest of the published
        dataset, not the AGPL that covers the rest of the repository. Game facts shown beside the text come from
        Blizzard&apos;s game files and stay Blizzard&apos;s. The published pages are listed on the{" "}
        <Link href="/wiki" className={docLink}>wiki</Link>.
      </P>

      <H2 id="file">A page</H2>
      <P>
        One file per page, <C>&lt;slug&gt;.md</C>, Markdown with YAML front matter. Not MDX: a page holds text and
        references, never code.
      </P>
      <div className="mt-6">
        <CodeGroup title="kb/wiki/deadmines.md" tabs={[{ label: "Front matter", lang: "yaml", code: FRONT_MATTER }]} />
      </div>
      <P>
        In the body, sections are <C>##</C> headings in the order the page type sets. These tokens link to the database
        and render the name the site may show:
      </P>
      <Table
        head={["Token", "Renders"]}
        rows={[
          [<Fragment key="t"><C>{"{item:N}"}</C>, <C>{"{npc:N}"}</C>, <C>{"{quest:N}"}</C>, <C>{"{zone:N}"}</C>, <C>{"{faction:N}"}</C></Fragment>, "the entity's name, linked to its database page"],
          [<C key="t">[[slug]]</C>, "a link to another wiki page"],
        ]}
      />
      <P>
        Infoboxes and data blocks (bosses, loot, quests, NPCs) are placed by the page type, not written, so an editor
        cannot drop or reorder them.
      </P>

      <H2 id="types">Types and sections</H2>
      <Table
        head={["Type", "Binds", "Sections, in order"]}
        rows={[
          [<Fragment key="t"><C>dungeon</C>, <C>raid</C></Fragment>, <Fragment key="b"><C>entrance</C> (slug of the entrance name), optional <C>zone</C>, <C>lfgDungeon</C></Fragment>, "Overview, Getting there, History, In WoW: Forever, then optionally Before you go"],
          [<C key="t">zone</C>, <Fragment key="b"><C>zone</C> (UiMap id)</Fragment>, "Overview, History, In WoW: Forever"],
          [<C key="t">npc</C>, <C key="b">npc</C>, "Who they are, Where to find them, In WoW: Forever"],
          [<C key="t">faction</C>, <C key="b">faction</C>, "Overview, History, How players gain standing, then optionally In WoW: Forever"],
          [<C key="t">item-set</C>, <C key="b">itemSet</C>, "Overview, Who wears it, then optionally In WoW: Forever"],
          [<C key="t">event</C>, <C key="b">holiday</C>, "What happens, In WoW: Forever"],
          [<C key="t">concept</C>, <Fragment key="b">optional <C>tool</C> (a site path)</Fragment>, "free, at most four"],
          [<C key="t">change</C>, <Fragment key="b"><C>changes</C> (entry ids on /changes)</Fragment>, "What changed, What it affects"],
          [<Fragment key="t"><C>race</C>, <C>class</C></Fragment>, <Fragment key="b"><C>race</C>, <C>class</C></Fragment>, "Overview, In WoW: Forever"],
        ]}
      />

      <H2 id="rules">Rules</H2>
      <List>
        <li>
          <strong>No hand-typed gameplay numbers.</strong> A level, rate, count, coordinate, price or player limit comes
          from the infobox or a data block. Inside a quote (Blizzard&apos;s words, linked to the post) is the only exception.
        </li>
        <li>
          <strong>Nothing above the shown id ranges.</strong> New Forever content is written about only from a Blizzard
          post or from what players have recorded, never from the game files alone.
        </li>
        <li>
          <strong>Announced but not in the files yet.</strong> A <C>dungeon</C> or <C>raid</C> page may leave out{" "}
          <C>entrance</C>, and a <C>race</C> page <C>race</C>, only when its <C>sources</C> list a Blizzard post
          (worldofwarcraft.blizzard.com or the US or EU forums). The binding is added once the game files have it.
        </li>
        <li>
          <strong>Before you go is advice.</strong> A <C>dungeon</C> or <C>raid</C> page may end with what a group should
          know before going in, in our own words. An adapted page has none. On a published page the section needs words
          of its own, not only a quote; leave the heading out until there are some. The page shows the level, the
          entrance and the bosses in its facts, and the number rule above applies to the advice as to every section.
        </li>
        <li>
          <strong>Original pages only for now.</strong> An original page is written in our own words from the game files,
          Blizzard&apos;s posts and Everloot&apos;s data. An adapted page reuses Warcraft Wiki text; it needs{" "}
          <C>adaptedFrom</C> for its credit line and cannot be published until the overlap check against the wiki dump
          exists.
        </li>
        <li>
          <strong>Published pages meet the index bar:</strong> at least 150 words of our own prose, at least one binding
          so the page shows live data, an &quot;In WoW: Forever&quot; section (for <C>change</C> pages, &quot;What
          changed&quot;) with something in it, and a maintainer&apos;s review recorded in <C>reviewed</C>.
        </li>
        <li>
          <strong>Links:</strong> every <C>[[slug]]</C> names an existing page, and so does every Markdown link into the
          wiki (<C>[text](/wiki/slug)</C>, also with a trailing slash, a query or a fragment, or written out on
          everloot.app). A published page links only to published pages; the site draws a link to any other page as
          plain words.
        </li>
        <li>No private paths, internal names or AI tool credits.</li>
      </List>

      <H2 id="check">Check a page</H2>
      <P>From the root of the repository:</P>
      <div className="mt-6">
        <CodeGroup tabs={[{ label: "Shell", lang: "bash", code: "npm run kb -- wiki-check" }]} />
      </div>
      <P>
        CI runs the same check on every pull request. Every content change is reviewed like code: the check passes, a
        maintainer reads the page and approves it.
      </P>

      <H2 id="propose">Propose a page</H2>
      <P>
        A page is proposed the way code is: a file in{" "}
        <a href={`${REPO}/tree/main/kb/wiki`} className={docLink}>kb/wiki</a>, sent as a{" "}
        <a href={`${REPO}/pulls`} className={docLink}>pull request</a> to the repository. Leave <C>status</C> at{" "}
        <C>draft</C>; a draft is not built on the site. A page is published when it meets the index bar and a
        maintainer records the review in <C>reviewed</C>. The repository&apos;s{" "}
        <a href={`${REPO}/blob/main/CONTRIBUTING.md`} className={docLink}>contributing guide</a> covers the pull request
        itself.
      </P>
    </DocPage>
  );
}
