import { API_ROUTES, API_SCHEMAS, LICENCE, LICENCE_URL, PROTOCOL_VERSION, SITE, TERMS_URL, type ApiRoute } from "@everloot/protocol";
import { liveToolNames } from "@/lib/guild-switch";
import { z } from "zod";

/**
 * The OpenAPI 3.1 description of everloot.app's JSON API, assembled from the protocol's route catalogue
 * and response schemas, so the document can never describe an endpoint the protocol does not. Served at
 * /api/openapi.json and linked from the docs. OpenAPI 3.1 schemas are JSON Schema 2020-12, which is what
 * zod emits, so the response shapes go in as they are.
 */

const ACCESS_TEXT: Record<ApiRoute["access"], string> = {
  open: "Open: no key, no limit of its own.",
  "rate-limited": "Rate limited per IP address; no key.",
  "key-or-rate-limited": "Open without a key within a per-IP limit; a free key (see /docs/api/keys) raises the limit and the page size once keys are on.",
  cron: "Internal.",
};

const DATA_TEXT: Record<ApiRoute["data"], string> = {
  observed: "Player observations, Everloot's data under CC BY-SA 4.0: every answer carries `attribution` and the X-Everloot-Licence, X-Everloot-Credit and Link headers.",
  "game-files": "Game-file data: Blizzard's, found in game files, unconfirmed, stamped with its build; carries a `gameData` notice instead of Everloot's licence.",
  mixed: "Observed rows carry `attribution`; game-file rows are Blizzard's and the page carries a `gameData` notice when it holds any.",
  none: "No data layer.",
};

type Json = Record<string, unknown>;

function componentSchema(schema: z.ZodType): Json {
  const json = z.toJSONSchema(schema, { io: "output", target: "draft-2020-12", unrepresentable: "any" }) as Json;
  delete json.$schema;
  return json;
}

function operationId(route: ApiRoute): string {
  // A path parameter `{tool}` reads as `ByTool`, so the id stays a plain identifier.
  const segments = route.path.replace(/^\/api/, "").split("/").filter(Boolean).map((p) => (/^\{.+\}$/.test(p) ? `by-${p.slice(1, -1)}` : p));
  return `${route.method.toLowerCase()}${segments.map((p) => p[0].toUpperCase() + p.slice(1).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())).join("")}`;
}

function operation(route: ApiRoute): Json {
  const parameters = [
    ...(route.pathParams ?? []).map((p) => ({ name: p.name, in: "path", required: true, description: p.description, schema: p.schema })),
    ...(route.query ?? []).map((q) => ({ name: q.name, in: "query", required: q.required ?? false, description: q.description, schema: q.schema })),
  ];
  const responses: Json = {};
  for (const [code, response] of Object.entries(route.responses)) {
    responses[code] = {
      description: response.description,
      ...(response.schema ? { content: { "application/json": { schema: { $ref: `#/components/schemas/${response.schema}` } } } } : {}),
    };
  }
  return {
    operationId: operationId(route),
    summary: route.summary,
    description: `${route.description}\n\n${ACCESS_TEXT[route.access]} ${DATA_TEXT[route.data]}${route.paged ? " Paged: `offset` and `limit`, with `next` as the URL of the following page or null." : ""}`,
    tags: [route.data === "none" ? (route.method === "POST" ? "uploads" : "status") : route.data],
    ...(parameters.length ? { parameters } : {}),
    ...(route.requestBody ? { requestBody: { required: true, content: { "application/json": { schema: { $ref: `#/components/schemas/${route.requestBody}` } } } } } : {}),
    responses,
    ...(route.access === "key-or-rate-limited" ? { security: [{}, { apiKey: [] }] } : {}),
  };
}

export function openApiDocument(): Json {
  const paths: Json = {};
  for (const route of API_ROUTES) {
    const entry = (paths[route.path] as Json | undefined) ?? {};
    entry[route.method.toLowerCase()] = operation(route);
    paths[route.path] = entry;
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Everloot API",
      version: PROTOCOL_VERSION,
      summary: "WoW: Forever data players reported, with the game-file layer beside it, as JSON.",
      description: [
        "Everloot publishes what players saw in WoW: Forever, and states a fact only once three installs reported it.",
        "The corpus and the drop rates are Everloot's data under CC BY-SA 4.0: credit it when you show it.",
        "Game-file endpoints carry Blizzard's data, found in game files and unconfirmed, with the build they came from; they are not under Everloot's licence.",
        `Every shape here is also published as JSON Schema under ${SITE}/schema/api/, and the same definitions are the @everloot/protocol package in the repository (packages/protocol), not yet on npm.`,
        `For answering questions, the MCP server at ${SITE}/mcp/public is the right tool; this API is for building datasets and tools.`,
      ].join(" "),
      termsOfService: TERMS_URL,
      contact: { name: "Everloot", url: `${SITE}/docs`, email: "hello@everloot.app" },
      license: { name: `${LICENCE} (data); AGPL-3.0-only (code)`, url: LICENCE_URL },
    },
    servers: [{ url: SITE }],
    tags: [
      { name: "observed", description: "Built from player uploads. Public after three installs agree." },
      { name: "game-files", description: "Read from the public game client. Blizzard's data, unconfirmed, stamped with the build." },
      { name: "mixed", description: "Observed rows and game-file rows side by side, each labelled." },
      { name: "uploads", description: "Sending records from the addon's SavedVariables file." },
      { name: "status", description: "Whether the public snapshot is fresh." },
    ],
    paths,
    components: {
      schemas: Object.fromEntries(Object.entries(API_SCHEMAS).map(([name, schema]) => [name, componentSchema(schema)])),
      securitySchemes: {
        apiKey: {
          type: "http", scheme: "bearer",
          description: `A free key from ${SITE}/docs/api/keys, sent as Authorization: Bearer <key>. Only needed to copy in bulk once keys are switched on.`,
        },
      },
    },
    "x-everloot": {
      protocol: PROTOCOL_VERSION,
      schemas: `${SITE}/schema/index.json`,
      mcp: { endpoint: `${SITE}/mcp/public`, tools: liveToolNames(), toolSchema: `${SITE}/schema/mcp/{tool}.json` },
      source: "https://github.com/Everloot/everloot",
    },
  };
}
