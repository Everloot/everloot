import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import type { McpToolName } from "@everloot/protocol";
import { liveToolNames } from "@/lib/guild-switch";
import { C, Callout, H2, P, Params, docLink } from "@/components/docs/blocks";
import { CodeGroup } from "@/components/docs/DocsClient";
import DocPage from "@/components/docs/DocPage";
import { toolFromSlug, toolHref } from "@/lib/docs/nav";
import { toolSamples } from "@/lib/docs/examples";
import { toolDocs } from "@/lib/protocol-docs";
import { DESCRIPTION_MAX, DESCRIPTION_MIN, pageMetadata } from "@/lib/seo";

/** One page per MCP tool, generated from the protocol's tool definitions (MCP_TOOLS). */

const GRANT = <Link href="/docs/guides/upload#get-a-grant" className={docLink}>sharing grant</Link>;
const INSTALL_ID = (
  <>
    Your install id is the code in brackets on the first line of <C>/everloot status</C> in game. Anyone who has it can
    read the progress you shared, so keep it private.
  </>
);

/** Tools whose rule is not the usual 3-install one get their own note instead of the generic one. */
const TOOL_NOTES: Partial<Record<McpToolName, ReactNode>> = {
  item_page: (
    <>
      Player-reported armor, block, damage per second, stats and resistances are in <C>page.reported</C>.
      Each line uses the newest build with 3 reporting installs and each install&apos;s latest vote.
      A unique value needs 3 agreeing installs; competing winners or split votes disclose no value.
      Shown numbers carry agreeing install counts, build and last seen, alongside the corpus date and method.
      The text prints <C>[?]</C> with a reason for missing or contested numbers; structured unknown times are null.
      Missing lines are unknown, never zero. The input is still only <C>itemId</C>.
    </>
  ),
  coverage: (
    <>
      Reads the same score as <Link href="/database/coverage" className={docLink}>Database coverage</Link>.
      Omit zone and type for all released zones and types, or pass a UiMap zone id and a type to narrow the answer.
      Counts are entity-field facts: settled / expected, with confirmed / expected beside it, using the larger of
      expected and observed as the denominator. Each answer includes the method, corpus date, build and install counts.
      The reported-fields list identifies fields needing votes without disclosing their unconfirmed values.
      Scoped totals count settled, confirmed (including settled), still reported and recheck fields.
      The whole-fact settled-list size is separate: it covers the entire current build before filters, at upload-fact
      grain, with its own snapshot date. That list stores no install count, so its installs read <C>[?]</C>.
      An undated or unavailable list is unknown. A dated empty list is measured zero.
      Type-filtered counts of fields needing one or two installs read <C>[?]</C> when the page&apos;s cap prevents a full count.
      Baseline data contributes counts only. Unknown values read <C>[?]</C>. The answer is text only.
    </>
  ),
  guild_board: (
    <>
      Built on officers&apos; uploads, not the 3-install rule: a figure is public when uploads from 2 of the guild&apos;s
      officers agree, each holding a verified {GRANT} for that guild. The answer ends with the age of the data and the
      credit line.
    </>
  ),
  gold_ledger: (
    <>
      Reads one character&apos;s own upload, shared by its owner with a verified {GRANT}, so no agreement between installs
      is needed. A character whose owner has not shared gold has no ledger. The answer ends with the age of the data and
      the credit line.
    </>
  ),
  collection_gap: (
    <>
      The collection lists follow the 3-install rule. What you own comes from your own upload, shared with the collection
      choice and a verified {GRANT}. {INSTALL_ID}
    </>
  ),
  completion_progress: (
    <>
      The lists follow the 3-install rule. Your progress comes from your own upload, shared with the collection choice and
      a verified {GRANT}. {INSTALL_ID}
    </>
  ),
};

export const dynamicParams = false;

export function generateStaticParams() {
  return liveToolNames().map((name) => ({ tool: name.replaceAll("_", "-") }));
}

export async function generateMetadata({ params }: { params: Promise<{ tool: string }> }): Promise<Metadata> {
  const name = toolFromSlug((await params).tool);
  const doc = name && toolDocs().find((d) => d.name === name);
  if (!doc) return {};
  return pageMetadata({ title: `${doc.name}: ${doc.title} · MCP tool`, description: toolDescription(doc.description), path: toolHref(doc.name) });
}

/**
 * The tool's description, and when that is under DESCRIPTION_MIN, what the page documents. The first addition that
 * fits DESCRIPTION_MAX wins, so a longer description keeps less of it.
 */
function toolDescription(text: string): string {
  const base = metaDescription(text);
  if (base.length >= DESCRIPTION_MIN) return base;
  const choices = [`${base} An Everloot MCP tool: its parameters, its answer and the same call over HTTP.`, `${base} An Everloot MCP tool.`];
  return choices.find((t) => t.length <= DESCRIPTION_MAX) ?? base;
}

/** The tool's description in whole sentences while they fit DESCRIPTION_MAX; a first sentence too long on its own is cut at a word. */
function metaDescription(text: string): string {
  let out = "";
  for (const sentence of text.split(/(?<=\.)\s/)) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > DESCRIPTION_MAX) break;
    out = next;
  }
  return out || `${text.slice(0, DESCRIPTION_MAX - 1).replace(/\s+\S*$/, "")}…`;
}

export default async function ToolPage({ params }: { params: Promise<{ tool: string }> }) {
  const name = toolFromSlug((await params).tool);
  const doc = name && toolDocs().find((d) => d.name === name);
  if (!doc) notFound();
  const aside = (
    <>
      <CodeGroup title="Call it" tabs={toolSamples(doc.name)} />
      <p data-md-skip className="text-xs leading-5 text-muted">Arguments show the shape of a call; check the parameters for real values.</p>
    </>
  );
  return (
    <DocPage href={toolHref(doc.name)} title={<span className="font-mono text-2xl sm:text-3xl">{doc.name}</span>} lede={doc.title} aside={aside}>
      <P>{doc.description}</P>
      {TOOL_NOTES[doc.name] ? (
        <Callout kind="note"><p>{TOOL_NOTES[doc.name]}</p></Callout>
      ) : doc.playerData ? (
        <Callout kind="note"><p>Built on player uploads: a fact appears once 3 installs agree on it, an answer says when something is not recorded yet, and it ends with the age of the data and the credit line.</p></Callout>
      ) : (
        <Callout kind="note"><p>Carries its sources inside the answer. Anything read from the game files is labelled unconfirmed, with its build.</p></Callout>
      )}

      <H2 id="parameters">Parameters</H2>
      <Params rows={doc.params} empty="This tool takes no arguments." />

      <H2 id="answer">The answer</H2>
      <P>
        Text for the assistant to read{doc.structured ? <>, and <C>structuredContent</C> with these top-level fields</> : ""}. The JSON Schema is at{" "}
        <a href={`/schema/mcp/${doc.name}.json`} className={docLink}><C>{`/schema/mcp/${doc.name}.json`}</C></a>.
      </P>
      {doc.structured && <Params rows={doc.output} />}

      <H2 id="without-mcp">Without an MCP client</H2>
      <P>
        The same answer is a GET away: <C>{`/api/tools/${doc.name}`}</C> with the arguments in the query string. See{" "}
        <Link href="/docs/api/tools" className={docLink}>the endpoint</Link> and{" "}
        <Link href="/docs/cookbook/tools-over-http" className={docLink}>the recipe</Link>.
      </P>
    </DocPage>
  );
}
