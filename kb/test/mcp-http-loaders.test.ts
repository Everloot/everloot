import { afterEach, expect, test } from "vitest";
import { openDb, type DB } from "../src/db.js";
import { buildFilesIndex } from "../src/files-evidence.js";
import { createMcpHttpHandler } from "../src/mcp-http-server.js";

const databases: DB[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

// SYNTHETIC game-data files; the names are made up.
const index = buildFilesIndex({
  map: { source: { version: "1.0.0.1" }, zones: [{ uiMapId: 1, name: "Synthetic Forest" }], entrances: [{ mapId: 34, name: "Synthetic Stockade", raid: false, uiMapId: 1 }] },
  encounters: { instances: { "34": [{ id: 1, name: "Synthetic Warden" }] } },
});

const call = (body: unknown) => new Request("http://localhost/mcp", {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: body }),
});

test("the HTTP mount hands the game files' facts to answer_sources, as /api/tools does", async () => {
  const db = openDb(":memory:");
  databases.push(db);
  const handle = createMcpHttpHandler({ db, bearerToken: null, maxRequestBodyBytes: 4096, rateLimitPerMinute: 50, allowedOrigins: [], gameData: () => index });
  const result = (await (await handle(call({ name: "answer_sources", arguments: { question: "which bosses are in Synthetic Stockade", limit: 3 } }))).json()).result;
  const evidence = result.structuredContent.evidence as { kind: string; claim: string }[];
  expect(evidence[0]).toMatchObject({ kind: "files", claim: "Synthetic Stockade: a dungeon, entered from Synthetic Forest; the files list 1 encounters: Synthetic Warden." });
  expect(result.content[0].text).toContain("[game files, found in game files and unconfirmed] Synthetic Stockade");
});
