import { expect, test } from "vitest";
import { asciiJsonText } from "./ascii-json";

/** A response whose body arrives in the given pieces, so a character can be split across two of them. */
function inPieces(bytes: Uint8Array, cuts: number[], headers: HeadersInit = {}): Response {
  const ends = [...cuts, bytes.length];
  let start = 0;
  const pieces = ends.map((end) => { const piece = bytes.slice(start, end); start = end; return piece; });
  return new Response(new ReadableStream<Uint8Array>({ start(c) { for (const p of pieces) c.enqueue(p); c.close(); } }), { headers });
}

const value = {
  plain: "Hogger",
  accents: "Brûlé – Kel'Thuzad’s “Ward”",
  wide: ["龍", "Ω", "𝄞 and 😀"],
  inner: "zero﻿width",
  nested: { "Ünïcode kéy": ["é", { "ß": 1 }] },
  escaped: "already \\u00e9 and \" quote \n line",
};

test("the text has nothing outside ASCII and parses to what the response's own text parses to", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const text = await asciiJsonText(new Response(bytes));
  expect([...text].every((c) => c.charCodeAt(0) < 0x80)).toBe(true);
  expect(JSON.parse(text)).toEqual(JSON.parse(await new Response(bytes).text()));
  expect(JSON.parse(text)).toEqual(value);
});

test("a character split between two pieces of the body reads whole, at every cut", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  for (let cut = 1; cut < bytes.length; cut++) {
    expect(JSON.parse(await asciiJsonText(inPieces(bytes, [cut])))).toEqual(value);
  }
  // Many small pieces, with the size the response says it has and without it.
  const cuts = Array.from({ length: Math.floor(bytes.length / 3) }, (_, i) => (i + 1) * 3);
  expect(JSON.parse(await asciiJsonText(inPieces(bytes, cuts, { "content-length": String(bytes.length) })))).toEqual(value);
  expect(JSON.parse(await asciiJsonText(inPieces(bytes, cuts, { "content-length": "4" })))).toEqual(value);
});

test("a leading byte order mark is dropped and broken bytes read as the response's own text reads them", async () => {
  const body = new TextEncoder().encode(JSON.stringify({ a: "x", b: "é" }));
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...body]);
  expect(JSON.parse(await asciiJsonText(new Response(bom)))).toEqual({ a: "x", b: "é" });
  // A lone continuation byte, a cut-off sequence before a quote, and an overlong form: each a replacement character.
  const broken = new Uint8Array([...new TextEncoder().encode('{"a":"'), 0x80, 0x41, 0xe9, 0x8e, 0x22, 0x2c, 0x22, 0x62, 0x22, 0x3a, 0x22, 0xc0, 0xaf, 0x22, 0x7d]);
  expect(JSON.parse(await asciiJsonText(new Response(broken)))).toEqual(JSON.parse(await new Response(broken).text()));
  for (let cut = 1; cut < broken.length; cut++) {
    expect(JSON.parse(await asciiJsonText(inPieces(broken, [cut])))).toEqual(JSON.parse(await new Response(broken).text()));
  }
});

test("an empty body is empty text, and a body that is not JSON stays text that does not parse", async () => {
  expect(await asciiJsonText(new Response(""))).toBe("");
  expect(() => JSON.parse("not json")).toThrow();
  expect(await asciiJsonText(new Response("not json"))).toBe("not json");
});

test("a character after a lone backslash, no escape in JSON, does not become one: the text still fails to parse", async () => {
  const bad = new TextEncoder().encode('{"a":"x\\é"}');
  expect(() => JSON.parse(new TextDecoder().decode(bad))).toThrow();
  for (let cut = 0; cut < bad.length; cut++) {
    const text = await asciiJsonText(cut ? inPieces(bad, [cut]) : new Response(bad));
    expect(() => JSON.parse(text)).toThrow();
  }
  // An escaped backslash before it is fine, as it is in the response's own text.
  const fine = new TextEncoder().encode('{"a":"\\\\é"}');
  expect(JSON.parse(await asciiJsonText(new Response(fine)))).toEqual({ a: "\\é" });
});
