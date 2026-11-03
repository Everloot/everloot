import { expect, test } from "vitest";
import { readAllRows } from "./postgrest-pages";

/** A PostgREST page: its rows and the Content-Range it reports. */
const page = (rows: string[], range: string) =>
  new Response(JSON.stringify(rows), { status: 206, headers: { "content-range": range } });

/** Serves the given pages in order, whatever offset is asked for, and records the offsets. */
function pages(...served: Response[]) {
  const offsets: number[] = [];
  return { offsets, read: (offset: number) => { offsets.push(offset); return Promise.resolve(served.shift()!); } };
}

test("one page holding the whole table is complete", async () => {
  const p = pages(page(["a", "b"], "0-1/2"));
  expect(await readAllRows(p.read)).toEqual(["a", "b"]);
});

test("an empty table is complete", async () => {
  expect(await readAllRows(pages(page([], "*/0")).read)).toEqual([]);
});

test("pages are read from the rows actually returned, up to the total", async () => {
  const p = pages(page(["a", "b"], "0-1/3"), page(["c"], "2-2/3"));
  expect(await readAllRows(p.read)).toEqual(["a", "b", "c"]);
  expect(p.offsets).toEqual([0, 2]);
});

test("a row added between pages changes the total, and the read is an error", async () => {
  // a is inserted before page two, shifting c into it again and pushing d in: [b,c,c,d] would miss a.
  const p = pages(page(["b", "c"], "0-1/3"), page(["c", "d"], "2-3/4"));
  await expect(readAllRows(p.read)).rejects.toThrow(/count changed/);
});

test("a row removed between pages changes the total, and the read is an error", async () => {
  // a is deleted after page one, so offset two skips c: [a,b,d] would miss c.
  const p = pages(page(["a", "b"], "0-1/4"), page(["d"], "2-2/3"));
  await expect(readAllRows(p.read)).rejects.toThrow(/count changed/);
});

test("a range that runs past the total is an error", async () => {
  await expect(readAllRows(pages(page(["a", "b"], "0-1/1")).read)).rejects.toThrow(/range/);
});

test("pages that stop before the total are an error", async () => {
  await expect(readAllRows(pages(page(["a"], "0-0/2"), page([], "*/2")).read)).rejects.toThrow(/stopped/);
});

test("a missing or unknown total is an error", async () => {
  await expect(readAllRows(pages(new Response("[]", { status: 200 })).read)).rejects.toThrow(/count missing/);
  await expect(readAllRows(pages(page(["a"], "0-0/*")).read)).rejects.toThrow(/count missing/);
});
