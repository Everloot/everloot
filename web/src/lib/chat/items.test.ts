import { expect, test, vi } from "vitest";
import { itemQuery, itemRef, resolveItem, suggestItems } from "./items";

const LINEN = [
  { type: "item", id: 2589, label: "Linen Cloth", href: "/database/items/2589", quality: 1 },
  { type: "item", id: 2996, label: "Bolt of Linen Cloth", href: "/database/items/2996", quality: 1 },
  { type: "item", id: 2572, label: "Red Linen Robe", href: "/database/items/2572", quality: 2 },
];
const suggest = (results: unknown[], status = 200) => vi.fn(async () => Response.json({ results }, { status }));

test("item questions name the item; other questions are left to the chat as before", () => {
  expect(itemQuery("Where does Linen Cloth drop?")).toBe("Linen Cloth");
  expect(itemQuery("where do I get linen cloth")).toBe("linen cloth");
  expect(itemQuery("What drops Linen Cloth?")).toBe("Linen Cloth");
  expect(itemQuery("Who drops the Red Linen Robe")).toBe("the Red Linen Robe");
  expect(itemQuery("Where does The Unstoppable Force drop?")).toBe("The Unstoppable Force");
  expect(itemQuery("What is the Linen Cloth drop rate?")).toBe("the Linen Cloth");
  expect(itemQuery("Where can I farm Linen Cloth?")).toBe("Linen Cloth");
  for (const q of ["Where does Linen Cloth drop from?", "Where do I get Linen Cloth from?", "Where does Linen Cloth drop in Forever?", "Linen Cloth drop rate", "Show me Linen Cloth", "What is Linen Cloth?", "Tell me about Linen Cloth"]) {
    expect(itemQuery(q)).toBe("Linen Cloth");
  }
  for (const q of ["Plan a level 40 Fury warrior", "What changed in the last build?", "What sells best on my realm?", "hi", "Where is Leeroy Jenkins?", "where does it drop"]) {
    expect(itemQuery(q)).toBeNull();
  }
});

test("the exact name wins over similar names, whatever order the suggestions come in", async () => {
  const send = suggest([LINEN[2], LINEN[1], LINEN[0]]);
  expect(await resolveItem("Linen Cloth", undefined, send as never)).toEqual({ id: 2589 });
  expect(send).toHaveBeenCalledWith("/search/suggest?q=Linen+Cloth&in=item", expect.objectContaining({ signal: undefined }));
  expect(await resolveItem("linen cloth ", undefined, suggest(LINEN) as never)).toEqual({ id: 2589 });
});

test("no exact name, or the same name twice, offers choices instead of a guess", async () => {
  expect(await resolveItem("Linen", undefined, suggest(LINEN) as never)).toEqual({ query: "Linen" });
  expect(await resolveItem("Red Linen", undefined, suggest([LINEN[2]]) as never)).toEqual({ query: "Red Linen" });
  const twins = [LINEN[0], { ...LINEN[1], label: "Linen Cloth" }];
  expect(await resolveItem("Linen Cloth", undefined, suggest(twins) as never)).toEqual({ query: "Linen Cloth" });
});

test("nothing found, a failed lookup or rows that are not item pages resolve to nothing", async () => {
  expect(await resolveItem("Nothing", undefined, suggest([]) as never)).toBeNull();
  expect(await resolveItem("Linen Cloth", undefined, suggest([], 500) as never)).toBeNull();
  expect(await resolveItem("Linen Cloth", undefined, vi.fn(async () => { throw new Error("offline"); }) as never)).toBeNull();
  const bad = [
    { ...LINEN[0], href: "https://evil.example/database/items/2589" },
    { ...LINEN[0], id: 2590 },
    { ...LINEN[0], type: "npc" },
    { ...LINEN[0], id: -1, href: "/database/items/-1" },
  ];
  expect(await suggestItems("Linen Cloth", undefined, suggest(bad) as never)).toEqual([]);
});

test("a stopped lookup throws so nothing is written", async () => {
  const ctl = new AbortController();
  ctl.abort();
  const send = vi.fn(async (_u: string, init: RequestInit) => { if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError"); return Response.json({ results: LINEN }); });
  await expect(resolveItem("Linen Cloth", ctl.signal, send as never)).rejects.toThrow();
});

test("a saved reference keeps only an id or the player's own words", () => {
  expect(itemRef({ id: 2589, label: "Linen Cloth", lines: ["Sell Price 13c"] })).toEqual({ id: 2589 });
  expect(itemRef({ query: "Linen", choices: [{ id: 2589, label: "Linen Cloth" }] })).toEqual({ query: "Linen" });
  for (const raw of [null, "2589", { id: "2589" }, { id: 0 }, { id: 1.5 }, { query: "" }, { query: "x".repeat(201) }, {}]) expect(itemRef(raw)).toBeUndefined();
});

test("incidental substring matches do not turn a non-item query into item choices", async () => {
  const send = suggest([{ type: "item", id: 1934, label: "Hogger's Trousers", href: "/database/items/1934" }]);
  expect(await resolveItem("Hogger", undefined, send as never)).toBeNull();
});

test("articles in real item names are preserved; conversational articles can be retried", async () => {
  const force = { type: "item", id: 19323, label: "The Unstoppable Force", href: "/database/items/19323" };
  expect(await resolveItem("The Unstoppable Force", undefined, suggest([force]) as never)).toEqual({ id: 19323 });
  const send = vi.fn(async (url: string) => Response.json({ results: url.includes("q=the+") ? [] : LINEN }));
  expect(await resolveItem("the Linen Cloth", undefined, send as never)).toEqual({ id: 2589 });
  expect(send).toHaveBeenCalledTimes(2);
});
