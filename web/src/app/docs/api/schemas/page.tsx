import type { Metadata } from "next";
import Link from "next/link";
import { ALL_RECORD_KINDS, API_ROUTES, API_SCHEMAS, PROTOCOL_VERSION, PUBLIC_RECORD_KINDS, SITE, UPLOAD_LIMITS, type ApiSchemaName } from "@everloot/protocol";
import { C, H2, H3, List, P, Params, Table, docLink } from "@/components/docs/blocks";
import DocPage from "@/components/docs/DocPage";
import { endpointHref } from "@/lib/docs/nav";
import { schemaFields } from "@/lib/docs/examples";
import { FILE_SCHEMAS } from "@/lib/docs/file-schemas";
import { recordHref } from "@/lib/docs/records";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Schemas and the protocol",
  description: "Every response shape and record kind in Everloot's API, the upload envelope and its limits, and the protocol version they come from.",
  path: "/docs/api/schemas",
});

const REPO = "https://github.com/Everloot/everloot";

/** Where a schema is used: the routes that answer with it, send it as a body, or nothing (a shape other shapes reuse). */
function usedBy(name: ApiSchemaName) {
  return API_ROUTES.filter((route) => route.requestBody === name || Object.values(route.responses).some((r) => r.schema === name));
}

export default function SchemasPage() {
  const names = Object.keys(API_SCHEMAS) as ApiSchemaName[];
  return (
    <DocPage href="/docs/api/schemas">
      <P>
        The contract behind the API is one package, <C>@everloot/protocol</C>, record protocol <C>{PROTOCOL_VERSION}</C>: the{" "}
        {ALL_RECORD_KINDS.length} record kinds the addon writes, the upload envelope and its limits, the {names.length} response
        shapes below and the MCP tool table. The site validates uploads with it, the MCP server registers its tools from it, and
        these pages are rendered from it.
      </P>

      <H2 id="json-schema-files">JSON Schema files</H2>
      <List>
        <li>
          <a href="/schema/index.json" className={docLink}><C>{`${SITE}/schema/index.json`}</C></a>: what is published, with the
          protocol version.
        </li>
        <li>
          <C>/schema/records/&lt;kind&gt;.json</C>: one JSON Schema (draft 2020-12) per record kind, with the rules the server
          checks that a schema cannot express written into the description.
        </li>
        <li>
          <a href="/schema/upload.json" className={docLink}><C>/schema/upload.json</C></a> and{" "}
          <a href="/schema/limits.json" className={docLink}><C>/schema/limits.json</C></a>: the upload envelope and its sizes.
        </li>
        <li>
          <C>/schema/api/&lt;name&gt;.json</C> and <C>/schema/mcp/&lt;tool&gt;.json</C>: the response shapes and the tool inputs.
        </li>
        <li>
          The OpenAPI document, <a href="/api/openapi.json" className={docLink}><C>/api/openapi.json</C></a>, refers to the same
          shapes.
        </li>
      </List>

      <H2 id="protocol-version">Protocol version</H2>
      <P>
        There are two numbers. The record protocol, <C>{PROTOCOL_VERSION}</C>, is the upload contract: uploaders stamp it on
        every envelope, and the server accepts the current major and the one before it. The package has its own version,
        which also moves when a response shape or a tool changes. Both follow semver. A new kind, field or tool is a minor
        release. A removal, a rename, a new required field or a tighter limit is a major release. The source and its
        changelog are in <a href={`${REPO}/tree/main/packages/protocol`} rel="noopener" className={docLink}>packages/protocol</a>.
        The package is not on npm yet, so install it from that folder or read the JSON Schema files above.
      </P>

      <H2 id="record-kinds">Record kinds</H2>
      <P>
        The addon writes records, and each has a <C>kind</C>. The public corpus holds the kinds marked below; the rest stay
        private to the upload. Each kind has a page with its fields, and its own schema file.
      </P>
      <Table
        head={["Kind", "In the public corpus", "Schema file"]}
        rows={ALL_RECORD_KINDS.map((kind) => [
          <Link key="k" href={recordHref(kind)} className={docLink}><C>{kind}</C></Link>,
          PUBLIC_RECORD_KINDS.includes(kind) ? "Yes" : "No",
          <a key="f" href={`/schema/records/${kind}.json`} className={docLink}><C>{`${kind}.json`}</C></a>,
        ])}
      />

      <H2 id="upload-limits">Upload limits</H2>
      <P>
        An upload is a JSON envelope of records. The server enforces every limit; the Desktop App and the upload page stay inside
        them. The same numbers are at <a href="/schema/limits.json" className={docLink}><C>/schema/limits.json</C></a>.
      </P>
      <Table
        head={["Limit", "Value"]}
        rows={[
          ["Records in one request", UPLOAD_LIMITS.recordsPerBatch.toLocaleString("en-US")],
          ["Request body, refused above this with 413", `${UPLOAD_LIMITS.maxBodyBytes.toLocaleString("en-US")} bytes`],
          ["What an uploader puts in one request", `${UPLOAD_LIMITS.batchBytes.toLocaleString("en-US")} bytes`],
          ["Records one SavedVariables file may hold before it is split", UPLOAD_LIMITS.recordsPerFile.toLocaleString("en-US")],
          ["Length of addonVersion", `${UPLOAD_LIMITS.addonVersionMax} characters`],
          ["Auction realms in one upload", String(UPLOAD_LIMITS.realmsPerUpload)],
        ]}
      />
      <P>
        Sending an upload is <Link href="/docs/api/intake" className={docLink}>POST /intake</Link>.
      </P>

      <H2 id="response-shapes">Response shapes</H2>
      <P>
        One section per shape. The fields are the top-level ones; the full shape, with everything nested, is in the JSON Schema
        file named under each heading. Three shapes describe a file of the bulk export rather than an endpoint&apos;s answer,
        and say so. Wherever a shape carries <C>reporters</C>, it is the count of installs that agree on that fact, the same
        number the open-data files call <C>installs</C>.
      </P>
      {names.map((name) => {
        const routes = usedBy(name);
        const file = FILE_SCHEMAS[name];
        return (
          <section key={name}>
            <H3 id={name}>{name}</H3>
            <P>
              <a href={`/schema/api/${name}.json`} className={docLink}><C>{`/schema/api/${name}.json`}</C></a>
              {routes.length > 0 ? (
                <>
                  {" "}Used by{" "}
                  {routes.map((route, i) => (
                    <span key={`${route.method} ${route.path}`}>
                      {i > 0 && ", "}
                      <Link href={endpointHref(route)} className={docLink}>{route.method} {route.path.replace(/^\/api/, "")}</Link>
                    </span>
                  ))}
                  .
                </>
              ) : file ? (
                <> Describes a file, not an endpoint: {file}.</>
              ) : (
                <> A part of other answers.</>
              )}
            </P>
            <Params rows={schemaFields(name)} empty="The fields are in the JSON Schema file." />
          </section>
        );
      })}
    </DocPage>
  );
}
