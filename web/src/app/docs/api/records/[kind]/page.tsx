import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ALL_RECORD_KINDS, CENSUS_KINDS, COMPLETION_KINDS, GUILD_KILL_KINDS, LINK_KINDS, PLAYER_KINDS, RUN_RECORD_KINDS, type RecordKind } from "@everloot/protocol";
import { C, Callout, H2, List, P, Params, docLink } from "@/components/docs/blocks";
import DocPage from "@/components/docs/DocPage";
import { isPublicKind, recordDescription, recordFields, recordFromSlug, recordHref, recordRules } from "@/lib/docs/records";
import { pageMetadata } from "@/lib/seo";

/** One page per record kind, generated from the protocol's record schemas (recordSchemas), the same source as /schema/records/<kind>.json. */

export const dynamicParams = false;

export function generateStaticParams() {
  return ALL_RECORD_KINDS.map((kind) => ({ kind }));
}

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }): Promise<Metadata> {
  const kind = recordFromSlug((await params).kind);
  if (!kind) return {};
  return pageMetadata({ title: `${kind} · Record kind`, description: recordMetaDescription(kind), path: recordHref(kind) });
}

function recordMetaDescription(kind: RecordKind): string {
  return `The ${kind} upload record in Everloot's protocol: every field with its type, whether it is required and what it means, from the JSON Schema.`;
}

/** `backticks` in the protocol's descriptions become code. */
function Prose({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`)/).map((part, i) => (part.startsWith("`") ? <C key={i}>{part.slice(1, -1)}</C> : part))}</>;
}

/** Where a kind goes once uploaded, from the protocol's own kind lists; the public corpus is said separately. */
function whereItGoes(kind: RecordKind): ReactNode {
  if (COMPLETION_KINDS.includes(kind)) {
    return <>Read by the completion rollup, never served raw: catalog entries appear on the database pages and in the MCP tools once 3 installs report them identically, and owned rows are shown only to the character&apos;s owner.</>;
  }
  if (CENSUS_KINDS.includes(kind)) return <>Published only as counts, on the <Link href="/census" className={docLink}>census</Link>; no row leaves the upload.</>;
  if (PLAYER_KINDS.includes(kind)) return <>Reaches the player pages as named rows; it is never in the public corpus.</>;
  if (LINK_KINDS.includes(kind)) return <>Goes to the account&apos;s character link endpoint and is never stored as sent.</>;
  if (GUILD_KILL_KINDS.includes(kind)) return <>Reaches the public only through the guild pages, the guild tools and the guild export files, which count the 2-install bar and leave hidden guilds out.</>;
  if (kind === "addon_seen") return <>Published only as the addon leaderboard&apos;s counts at three or more installs, never row by row.</>;
  if (RUN_RECORD_KINDS.includes(kind)) return <>Accepted only once the site collects runs and pulls; until then an uploader holds these records back. Intake writes them to their own tables, never to the public corpus.</>;
  if (isPublicKind(kind)) {
    return (
      <>
        In the <Link href="/docs/api/corpus-public" className={docLink}>public corpus</Link>, one record at a time and without names; the site states a fact from it once 3 installs agree.
      </>
    );
  }
  return <>Private to the upload: it is not in the public corpus.</>;
}

export default async function RecordKindPage({ params }: { params: Promise<{ kind: string }> }) {
  const kind = recordFromSlug((await params).kind);
  if (!kind) notFound();
  const fields = recordFields(kind);
  const rules = recordRules(kind);
  const description = recordDescription(kind);
  const file = `/schema/records/${kind}.json`;
  return (
    <DocPage href={recordHref(kind)} title={<span className="font-mono text-2xl sm:text-3xl">{kind}</span>} lede={`One upload record of kind ${kind}: its fields, their types, and what the server checks.`}>
      <P>
        The addon writes <C>{kind}</C> records to SavedVariables and the uploaders send them in the{" "}
        <Link href="/docs/api/intake" className={docLink}>upload envelope</Link>. The server validates each one against this
        shape. The JSON Schema file is <a href={file} className={docLink}><C>{file}</C></a>; every kind is listed on{" "}
        <Link href="/docs/api/schemas#record-kinds" className={docLink}>Schemas and the protocol</Link>.
      </P>
      {description && <P><Prose text={description} /></P>}

      <H2 id="where-it-goes">Where it goes</H2>
      <P>{isPublicKind(kind) ? "In the public corpus." : "Not in the public corpus."} {whereItGoes(kind)}</P>

      <H2 id="fields">Fields</H2>
      <P>
        In the schema&apos;s order, a nested field after its parent: <C>a.b</C> is a field of the object <C>a</C>, and{" "}
        <C>a[].b</C> a field of each item of the array <C>a</C>. A nested field is marked required only when everything
        above it is too.
      </P>
      <Params rows={fields.map((f) => ({ name: f.name, type: f.type, required: f.required, description: f.description ? <Prose text={f.description} /> : "" }))} />

      {rules.length > 0 && (
        <>
          <H2 id="server-checks">What the server also checks</H2>
          <Callout kind="note">
            <p>Rules across fields that a JSON Schema cannot express. An upload that breaks one is refused with the sentence as its reason.</p>
          </Callout>
          <List>{rules.map((rule) => <li key={rule}>{rule}.</li>)}</List>
        </>
      )}
    </DocPage>
  );
}
