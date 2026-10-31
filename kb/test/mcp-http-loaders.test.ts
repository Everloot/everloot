import { afterEach, expect, test } from "vitest";
import { openDb, type DB } from "../src/db.js";
import { buildFilesIndex } from "../src/files-evidence.js";
import { createMcpHttpHandler, toolOptionsOf } from "../src/mcp-http-server.js";

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
  expect(evidence[0]!.kind).toBe("files");
  expect(evidence[0]!.claim).toMatch(/^Synthetic Stockade: a dungeon, entered from Synthetic Forest; the files name 1 boss: Synthetic Warden/);
  expect(result.content[0].text).toContain("[game files, found in game files and unconfirmed] Synthetic Stockade");
});

test("answer_sources says when player observations could not be read, apart from when none are connected", async () => {
  const db = openDb(":memory:");
  databases.push(db);
  const ask = async (corpus?: () => Promise<never>) => {
    const handle = createMcpHttpHandler({ db, bearerToken: null, maxRequestBodyBytes: 4096, rateLimitPerMinute: 50, allowedOrigins: [], ...(corpus ? { corpus } : {}) });
    return (await (await handle(call({ name: "answer_sources", arguments: { question: "which bosses are in Synthetic Stockade", limit: 3 } }))).json()).result.content[0].text as string;
  };
  const failed = await ask(async () => { throw new Error("store down"); });
  expect(failed).toContain("Player observations could not be read just now, so the observed layer is unknown for this answer, not empty.");
  expect(failed).not.toContain("not connected here");
  const previous = { url: process.env.EVERLOOT_PUBLIC_CORPUS_URL, uploads: process.env.EVERLOOT_UPLOADS };
  delete process.env.EVERLOOT_PUBLIC_CORPUS_URL;
  delete process.env.EVERLOOT_UPLOADS;
  try {
    expect(await ask()).toContain("Player observations are not connected here");
  } finally {
    if (previous.url !== undefined) process.env.EVERLOOT_PUBLIC_CORPUS_URL = previous.url;
    if (previous.uploads !== undefined) process.env.EVERLOOT_UPLOADS = previous.uploads;
  }
});

test("toolOptionsOf: the loaders only; the mount's token, origins, limits and account tools stay out of the tool layer", () => {
  const gameData = () => index;
  const extraTools = () => [];
  const picked = toolOptionsOf({ bearerToken: "secret", allowedOrigins: ["https://x"], rateLimitPerMinute: 5, maxRequestBodyBytes: 1, extraTools, gameData, recheck: [] } as never);
  expect(picked).toEqual({ gameData, recheck: [] });
  expect(JSON.stringify(Object.keys(picked))).not.toContain("bearer");
});
