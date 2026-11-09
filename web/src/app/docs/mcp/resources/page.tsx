import type { Metadata } from "next";
import Link from "next/link";
import { buildsResource, MCP_PROMPTS as PROMPT_DEFS, MCP_PROMPT_NAMES, MCP_RESOURCE_TEMPLATE_LIST, MCP_RESOURCE_URIS, MCP_RESOURCES as RESOURCE_DEFS, type McpPromptName } from "@everloot/protocol";
import { z } from "zod";
import { C, H2, P, Table, docLink } from "@/components/docs/blocks";
import { CodeGroup } from "@/components/docs/DocsClient";
import DocPage from "@/components/docs/DocPage";
import { MCP_PROMPTS, MCP_RESOURCE_TEMPLATES, MCP_RESOURCES } from "@/lib/docs/connect-data";
import { sample, TOOL_ARGS } from "@/lib/docs/examples";
import { toolHref } from "@/lib/docs/nav";
import { pageMetadata } from "@/lib/seo";
import { promptText } from "../../../../../../kb/src/prompts";

export const metadata: Metadata = pageMetadata({
  title: "Resources and prompts",
  description: "The documents, entity pages and ready-made prompts Everloot's MCP server offers beside its tools, with their addresses and arguments.",
  path: "/docs/mcp/resources",
});

const rpc = (method: string, params: unknown) => JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }, null, 2);

/** The resources/read example: the first resource the server lists, and the shape of the document it answers with. */
const FIRST_RESOURCE = MCP_RESOURCE_URIS[0]!;
const buildsSchema = z.toJSONSchema(buildsResource, { io: "output", unrepresentable: "any" }) as Parameters<typeof sample>[0] & { $defs?: Parameters<typeof sample>[1] };
const RESOURCE_EXAMPLE = [
  { label: "Request", lang: "json", code: rpc("resources/read", { uri: FIRST_RESOURCE }) },
  { label: "Answer", lang: "json", code: JSON.stringify({ contents: [{ uri: FIRST_RESOURCE, mimeType: RESOURCE_DEFS[FIRST_RESOURCE].mimeType, text: "<the document>" }] }, null, 2) },
  { label: "The document", lang: "json", code: JSON.stringify(sample(buildsSchema, buildsSchema.$defs ?? {}), null, 2) },
];

/** The entity example: the item template filled in with the item the tool pages use. */
const ITEM_TEMPLATE = MCP_RESOURCE_TEMPLATE_LIST.find((t) => t.tool === "item_page")!;
const ITEM_ID = TOOL_ARGS.item_page.itemId!;
const ITEM_URI = ITEM_TEMPLATE.uriTemplate.replace(`{${ITEM_TEMPLATE.variable}}`, String(ITEM_ID));
const ENTITY_EXAMPLE = [
  { label: "Request", lang: "json", code: rpc("resources/read", { uri: ITEM_URI }) },
  { label: "Same as", lang: "json", code: rpc("tools/call", { name: ITEM_TEMPLATE.tool, arguments: { [ITEM_TEMPLATE.argument]: ITEM_ID } }) },
];

/** A believable value for each prompt's argument: the tool pages' own examples, so the two agree. */
const PROMPT_ARGS: Record<McpPromptName, Record<string, string>> = {
  answer_with_sources: { question: String(TOOL_ARGS.answer_sources.question) },
  review_talent_plan: { code: String(TOOL_ARGS.talent_plan.code) },
  what_changed: { game: "forever" },
};

/** The prompts/get call for one prompt, and the message the server answers with (kb/src/prompts.ts). */
function promptExample(name: McpPromptName) {
  return [
    { label: "Request", lang: "json", code: rpc("prompts/get", { name, arguments: PROMPT_ARGS[name] }) },
    { label: "First message", lang: "text", code: promptText(name, PROMPT_ARGS[name]) },
  ];
}

export default function ResourcesPage() {
  return (
    <DocPage href="/docs/mcp/resources">
      <H2 id="resources">Resources</H2>
      <P>
        Documents an assistant reads whole, with <C>resources/read</C>, instead of calling a tool with arguments. Their shapes are
        in <a href="/schema/mcp/resources.json" className={docLink}><C>/schema/mcp/resources.json</C></a>.
      </P>
      <Table
        head={["URI", "What it holds"]}
        rows={MCP_RESOURCES.map((resource) => [<C key="u">{resource.uri}</C>, resource.text])}
      />
      <P>
        One read of <C>{FIRST_RESOURCE}</C>. The answer is one entry in <C>contents</C>: the URI, the mime type and the whole
        document as <C>text</C>. For this resource the text is JSON of the shape in the third tab, with the schema&apos;s own
        examples where it gives them and placeholders of the right type elsewhere.
      </P>
      <CodeGroup title="resources/read" tabs={RESOURCE_EXAMPLE} className="mt-4" />

      <H2 id="entity-resources">Entity resources</H2>
      <P>
        Entity pages read as resources too, one URI per entity. Each answers with the same JSON as the named tool&apos;s structured
        answer, so a client that prefers resources to tool calls gets the same page. The tools are on{" "}
        <Link href="/docs/mcp" className={docLink}>the overview</Link>; one example is{" "}
        <Link href={toolHref("item_page")} className={docLink}><C>item_page</C></Link>.
      </P>
      <Table
        head={["URI template", "What it holds"]}
        rows={MCP_RESOURCE_TEMPLATES.map((t) => [<C key="u">{t.uriTemplate}</C>, t.text])}
      />
      <P>
        The template <C>{ITEM_TEMPLATE.uriTemplate}</C> filled in for item {ITEM_ID}. The <C>text</C> of the answer is exactly
        the <C>structuredContent</C> of the <C>{ITEM_TEMPLATE.tool}</C> call in the second tab, as a JSON string. A variable that
        is not a positive id (or, for <C>talents</C>, not a class slug) is refused with a message that says so.
      </P>
      <CodeGroup title="resources/read" tabs={ENTITY_EXAMPLE} className="mt-4" />

      <H2 id="prompts">Prompts</H2>
      <P>
        Ready-made instructions a client offers as commands (<C>prompts/get</C>). You fill the argument, and the assistant gets a
        message that says which tools to call and how to treat what they return. Their arguments are in{" "}
        <a href="/schema/mcp/prompts.json" className={docLink}><C>/schema/mcp/prompts.json</C></a>. Each prompt has its own
        section below, and the sidebar lists them under this page.
      </P>
      <Table
        head={["Prompt", "What it does"]}
        rows={MCP_PROMPTS.map((prompt) => [<a key="n" href={`#${prompt.name}`} className={docLink}><C>{prompt.name}</C></a>, prompt.text])}
      />

      {MCP_PROMPT_NAMES.map((name) => {
        const def = PROMPT_DEFS[name];
        const args = Object.entries(def.arguments) as [string, { description: string; required: boolean; values?: readonly string[] }][];
        return (
          <section key={name}>
            <H2 id={name}><span className="font-mono">{name}</span></H2>
            <P><strong className="text-fg">{def.title}.</strong> {def.description}</P>
            <Table
              head={["Argument", "Required", "What it is", "Allowed values"]}
              rows={args.map(([arg, a]) => [
                <C key="a">{arg}</C>,
                a.required ? "Yes" : "No",
                a.description,
                a.values ? a.values.map((v, i) => <span key={v}>{i > 0 && " or "}<C>{v}</C></span>) : "Any text",
              ])}
            />
            <P>
              The call, and the one user message the server answers with. The answer&apos;s <C>description</C> is the prompt&apos;s
              title; the text in the second tab is <C>messages[0].content.text</C>.
            </P>
            <CodeGroup title="prompts/get" tabs={promptExample(name)} className="mt-4" />
          </section>
        );
      })}
    </DocPage>
  );
}
