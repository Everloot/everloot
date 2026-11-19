import { API_ROUTES, settledListResponse } from "@everloot/protocol";
import { expect, test } from "vitest";
import { computeSettled, emptySettledList, listOf, SettledList } from "@kb/settled-list";

/** The protocol cannot import the knowledge base, so this keeps its response schema and the list the route serves in step. */

const asOf = "2026-10-22T00:00:00.000Z";
const old = "2026-10-01T00:00:00.000Z";
const sightings = Array.from({ length: 5 }, (_, i) => ({
  kind: "npc_sighting", installId: `inst-${i}-settled`, eventId: `e-${i}`, capturedAt: old, npcId: 1234, name: "Marshal Dughan", mapId: 1429, x: 42, y: 65, positionKind: "interaction", role: "questgiver", level: 12,
}));

test("the route is in the catalogue, open, with its build parameter and its 200 answer", () => {
  const route = API_ROUTES.find((r) => r.path === "/api/coverage/settled");
  expect(route).toMatchObject({ method: "GET", access: "open", data: "observed", responses: { "200": { schema: "settledListResponse" } } });
  expect(route?.query?.map((q) => [q.name, q.required])).toEqual([["build", true]]);
  expect(Object.keys(route!.responses)).toEqual(expect.arrayContaining(["200", "304", "400", "503"]));
});

test("an empty list and a computed list with a settled NPC both satisfy the protocol schema, and so does the kb schema's own parse", () => {
  const empty = emptySettledList("1.60.1.70450");
  expect(settledListResponse.parse(empty)).toEqual(empty);
  const list = listOf(computeSettled({ records: sightings, asOf, build: "1.60.1.70450" }));
  expect(list.npc_sighting.ids).toEqual([1234]);
  expect(settledListResponse.parse(list)).toEqual(list);
  expect(SettledList.parse(list)).toEqual(list);
});

test("the protocol schema refuses what the kb schema refuses: a wrong schema tag and a date that is not a time", () => {
  const list = emptySettledList("1.60.1.70450");
  expect(settledListResponse.safeParse({ ...list, schema: "everloot.settled/2" }).success).toBe(false);
  expect(settledListResponse.safeParse({ ...list, dataAsOf: "yesterday" }).success).toBe(false);
});
