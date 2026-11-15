import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildsResource, CREDIT_LINE, GAME_DATA_CREDIT, LICENCE, MCP_CREDIT, MCP_RESOURCE_LIST, MCP_RESOURCE_URIS, MCP_RESOURCES } from "@everloot/protocol";
import { afterEach, expect, test } from "vitest";
import { CLIENT_LAYER } from "../src/client-layer-file.js";
import { openDb, type DB } from "../src/db.js";
import { createMcpHttpHandler } from "../src/mcp-http-server.js";
import { createKnowledgeServer, SOURCE_URL } from "../src/mcp-server.js";
import { buildsContents, dataPolicyText, methodologyText } from "../src/resources.js";

/** The full policy with its line wrapping undone, so a phrase can be found across a break. */
const POLICY = readFileSync(join(import.meta.dirname, "..", "..", "docs", "DATA_POLICY.md"), "utf8").replace(/\s+/g, " ");

const databases: DB[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

async function client() {
  const db = openDb(":memory:");
  databases.push(db);
  const server = createKnowledgeServer(db);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const c = new Client({ name: "test", version: "0" });
  await c.connect(clientSide);
  return c;
}

async function read(uri: string) {
  const result = await (await client()).readResource({ uri });
  expect(result.contents).toHaveLength(1);
  const [content] = result.contents;
  expect(content.uri).toBe(uri);
  return content as { uri: string; mimeType: string; text: string };
}

test("resources/list is exactly the protocol's resource table, in order", async () => {
  // The static resources come first; the class resources a template lists follow (mcp-completions.test.ts checks them).
  const listed = (await (await client()).listResources()).resources.slice(0, MCP_RESOURCE_URIS.length);
  expect(listed.map((r) => ({ uri: r.uri, name: r.name, title: r.title, description: r.description, mimeType: r.mimeType }))).toEqual(MCP_RESOURCE_LIST);
  expect(MCP_RESOURCE_URIS.length).toBe(3);
});

test("every resource reads in the type it declares", async () => {
  for (const uri of MCP_RESOURCE_URIS) {
    const content = await read(uri);
    expect(content.mimeType).toBe(MCP_RESOURCES[uri].mimeType);
    expect(content.text.length).toBeGreaterThan(200);
  }
});

test("everloot://builds is the registry newest first, with the build the game-file facts come from", async () => {
  const builds = buildsResource.parse(JSON.parse((await read("everloot://builds")).text));
  expect(builds.gameFiles).toEqual(CLIENT_LAYER.build);
  expect(builds.credit).toBe(GAME_DATA_CREDIT);
  expect(builds.registry.length).toBeGreaterThan(0);
  const seen = builds.registry.map((b) => b.firstSeen);
  expect(seen).toEqual([...seen].sort().reverse());
  expect(builds).toEqual(buildsContents());
});

test("everloot://methodology states the counting rules the site's page states", async () => {
  const text = (await read("everloot://methodology")).text;
  expect(text).toBe(methodologyText(SOURCE_URL));
  for (const rule of [
    "three different installs", "/64 block", "Unrecorded is not zero", "0 windows with the item in 40 loot windows", "not a measured zero",
    "loot windows with the item divided by recorded loot windows", "found in game files, unconfirmed", "everloot://builds", "Character names", "install id",
    "list of addons", "player counts yet", `${SOURCE_URL}/blob/main/docs/DATA_POLICY.md`, MCP_CREDIT, GAME_DATA_CREDIT,
  ]) expect(text).toContain(rule);
  expect(text).not.toContain("recorded kills");
  expect(text).not.toContain("40 kills");
});

test("everloot://data-policy is the short form of docs/DATA_POLICY.md, with the link to the full one", async () => {
  const text = (await read("everloot://data-policy")).text;
  expect(text).toBe(dataPolicyText(SOURCE_URL));
  expect(text).toContain(`${SOURCE_URL}/blob/main/docs/DATA_POLICY.md`);
  expect(text).toContain(CREDIT_LINE);
  expect(text).toContain(LICENCE);
  // Every claim in the short form is a claim the full policy makes, in its words.
  for (const claim of [
    "not legal advice", "at least three installs", "three distinct reporters", "never published row by row",
    "officer's upload", "unencrypted", "found in game files, unconfirmed", "WoWDBDefs", "pages only", "2023-11-13",
    "Bulk scraping of any site", "robots.txt", "Content Blizzard encrypts stays encrypted", "never copy it",
    "stays under the same licence", "AGPL-3.0", "needs no key", "/docs/api/keys", "hello@everloot.app",
  ]) {
    expect(text).toContain(claim);
    expect(POLICY).toContain(claim);
  }
  // The full policy has every heading the short form has.
  for (const heading of ["## What we publish", "## What we refuse", "## Wowhead", "## Using our data: credit, limits and keys"]) expect(POLICY).toContain(heading);
});

test("the public HTTP mount serves resources without a bearer", async () => {
  const db = openDb(":memory:");
  databases.push(db);
  const handle = createMcpHttpHandler({ db, bearerToken: null, maxRequestBodyBytes: 4096, rateLimitPerMinute: 20, allowedOrigins: [] });
  const request = (method: string, params?: unknown) => new Request("http://localhost/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const list = await (await handle(request("resources/list"))).json();
  expect(list.result.resources.map((r: { uri: string }) => r.uri).slice(0, MCP_RESOURCE_URIS.length)).toEqual(MCP_RESOURCE_URIS);
  const policy = await (await handle(request("resources/read", { uri: "everloot://data-policy" }))).json();
  expect(policy.result.contents[0].mimeType).toBe("text/markdown");
  expect(policy.result.contents[0].text).toContain(CREDIT_LINE);
  const missing = await (await handle(request("resources/read", { uri: "everloot://nothing" }))).json();
  expect(missing.error).toBeDefined();
});
