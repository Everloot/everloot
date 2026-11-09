import type { ApiSchemaName } from "@everloot/protocol";

/**
 * Response shapes no endpoint answers with: they describe a file of the bulk export. They sit in the OpenAPI
 * document's components so a generated client can parse the files, and the schemas page says which file each one is.
 */
export const FILE_SCHEMAS: Partial<Record<ApiSchemaName, string>> = {
  bulkIndex: "index.json of a bulk export folder",
  guildKillsResponse: "guild-kills.ndjson of the bulk export",
  guildsResponse: "guilds.ndjson of the bulk export",
};

/**
 * Public GET routes a page of the site fetches for itself. They are outside the protocol package, so the OpenAPI
 * document and the endpoint pages do not describe them, and they can change with the page.
 */
export const PAGE_INTERNAL_ROUTES = ["/api/map/pins", "/api/suggest"] as const;
