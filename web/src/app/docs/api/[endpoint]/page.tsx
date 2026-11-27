import type { Metadata } from "next";
import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { API_ROUTES, SITE } from "@everloot/protocol";
import { H2, P, Params, Endpoint, C, docLink, Callout } from "@/components/docs/blocks";
import { CodeGroup } from "@/components/docs/DocsClient";
import DocPage from "@/components/docs/DocPage";
import { endpointHref, endpointSlug, routeFromSlug } from "@/lib/docs/nav";
import { requestSamples, responseSamples, schemaFields } from "@/lib/docs/examples";
import { guardOn } from "@/lib/data-guard";
import { DATA_LABEL } from "@/lib/protocol-docs";
import { DESCRIPTION_MAX, pageMetadata } from "@/lib/seo";

/** One page per public endpoint, generated from the protocol's route catalogue (API_ROUTES). */

export const dynamicParams = false;

export function generateStaticParams() {
  return API_ROUTES.map((route) => ({ endpoint: endpointSlug(route) }));
}

export async function generateMetadata({ params }: { params: Promise<{ endpoint: string }> }): Promise<Metadata> {
  const route = routeFromSlug((await params).endpoint);
  if (!route) return {};
  return pageMetadata({ title: `${route.method} ${route.path} · API Reference`, description: endpointDescription(route), path: endpointHref(route) });
}

/**
 * The summary, then who may call the endpoint and what the page lists. The first that fits DESCRIPTION_MAX wins,
 * so a long summary keeps less of what follows it.
 */
function endpointDescription(route: (typeof API_ROUTES)[number]): string {
  const summary = `${route.summary}.`;
  const lists = `its ${route.pathParams?.length || route.query?.length ? "parameters, " : ""}responses and example requests.`;
  const reference = `${route.method} ${route.path} in the Everloot API: ${lists}`;
  const choices = [`${summary} ${accessText(route)} ${reference}`, `${summary} ${reference}`, `${summary} The reference lists ${lists}`, summary];
  return choices.find((text) => text.length <= DESCRIPTION_MAX) ?? summary;
}

/** `backticks` in the protocol's descriptions become code. */
function Prose({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`)/).map((part, i) => (part.startsWith("`") ? <C key={i}>{part.slice(1, -1)}</C> : part))}</>;
}

const ACCESS_TEXT: Record<string, string> = {
  open: "Open to anyone, no key.",
  "rate-limited": "Open to anyone, limited per IP address.",
  "key-or-rate-limited": "Open to anyone, limited per IP address; a free API key raises the limit.",
  // The same routes while the data guard is off (EVERLOOT_DATA_GUARD): no limit and no key yet.
  "key-or-rate-limited-off": "Open to anyone, no key needed. This endpoint has no limit of its own today.",
  cron: "Internal.",
};

const accessText = (route: (typeof API_ROUTES)[number]) =>
  ACCESS_TEXT[route.access === "key-or-rate-limited" && !guardOn() ? "key-or-rate-limited-off" : route.access];

export default async function EndpointPage({ params }: { params: Promise<{ endpoint: string }> }) {
  const route = routeFromSlug((await params).endpoint);
  if (!route) notFound();
  const href = endpointHref(route);
  const ok = Object.entries(route.responses).find(([status]) => status.startsWith("2"));
  const fields = ok?.[1].schema ? schemaFields(ok[1].schema) : [];
  const responses = responseSamples(route);
  const aside = (
    <>
      <CodeGroup title={route.summary.length > 40 ? "Request" : route.summary} tabs={requestSamples(route)} />
      {responses.length > 0 && <CodeGroup title="Response" tabs={responses} />}
      <p data-md-skip className="text-xs leading-5 text-muted">Example values show the shape of an answer, not real data.</p>
    </>
  );
  return (
    <DocPage href={href} title={<span className="font-mono text-2xl sm:text-3xl">{route.path.replace(/^\/api/, "")}</span>} lede={route.summary} aside={aside}>
      <Endpoint method={route.method} path={route.path} base={SITE} />
      <P><Prose text={route.description} /></P>

      <H2 id="access">Access</H2>
      <P>{accessText(route)} Data: {DATA_LABEL[route.data]}. {route.access !== "open" && <>Limits and keys are explained on <Link href="/docs/api/keys" className={docLink}>Limits and keys</Link>.</>}</P>

      {route.pathParams?.length ? (
        <>
          <H2 id="path-parameters">Path parameters</H2>
          <Params rows={route.pathParams.map((p) => ({ name: p.name, type: typeOf(p.schema), required: true, description: <Prose text={p.description} /> }))} />
        </>
      ) : null}

      {route.query?.length || route.paged ? (
        <>
          <H2 id="query-parameters">Query parameters</H2>
          <Params rows={(route.query ?? []).map((p) => ({ name: p.name, type: typeOf(p.schema), required: p.required, description: <Prose text={p.description} /> }))} />
          {route.paged && <Callout kind="tip"><p>The answer is paged: pass <C>offset</C> and <C>limit</C>, and follow <C>next</C>, the address of the following page, until it is null.</p></Callout>}
        </>
      ) : null}

      {route.requestBody && (
        <>
          <H2 id="request-body">Request body</H2>
          <P>JSON of the <Link href={`/docs/api/schemas#${route.requestBody}`} className={docLink}><C>{route.requestBody}</C></Link> shape. The Desktop App and the upload page send it for you.</P>
        </>
      )}

      <H2 id="responses">Responses</H2>
      <Params rows={Object.entries(route.responses).map(([status, r]) => ({ name: status, type: r.schema ?? "no body", description: <Prose text={r.description} /> }))} />

      {fields.length > 0 && (
        <>
          <H2 id="response-fields">Response fields</H2>
          <P>The top-level fields of a successful answer. Full shapes are on <Link href="/docs/api/schemas" className={docLink}>Schemas</Link> and in <a href="/api/openapi.json" className={docLink}>the OpenAPI document</a>.</P>
          <Params rows={fields} />
        </>
      )}

      {route.path === "/api/market/prices" && (
        <>
          <H2 id="response-fields-no-realm">Response fields without a realm</H2>
          <P>
            Without <C>realm</C> the answer is the list of realms that have public values, the{" "}
            <Link href="/docs/api/schemas#marketRealmsResponse" className={docLink}><C>marketRealmsResponse</C></Link> shape.
            The example request above has no realm, so this is what it returns.
          </P>
          <Params rows={schemaFields("marketRealmsResponse")} />
        </>
      )}
    </DocPage>
  );
}

function typeOf(schema: Record<string, unknown>): string {
  if (Array.isArray(schema.enum)) return schema.enum.length > 6 ? "string (one of the listed names)" : `one of: ${schema.enum.join(", ")}`;
  return String(schema.type ?? "value");
}
