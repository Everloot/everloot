import { describe, expect, test } from "vitest";
import { ORDER_LIMIT, decodeOrder, encodeOrder } from "./share";
import type { Ranks } from "./types";

const ranks: Ranks = { 11: { rank: 5 }, 12: { rank: 5 }, 21: { rank: 2 }, 32: { rank: 1, choice: 1 } };
// By ascending node id, 11 is A, 12 is B, 21 is C and 32 is D.
const order = [11, 12, 11, 12, 11, 12, 11, 12, 11, 12, 21, 21, 32];
const sequence = "ABABABABABCCD";

/** Nodes 1 to n at one point each, and that order. */
const flat = (n: number): Ranks => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, { rank: 1 }]));
const upTo = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("spend order token", () => {
  test("a player-planned order is O1p- and one character per point, and reads back the same", () => {
    const token = encodeOrder(ranks, order, "planned");
    expect(token).toBe(`O1p-${sequence}`);
    expect(decodeOrder(token!, ranks)).toEqual({ ok: true, origin: "planned", order });
  });

  test("a generated order is O1g- and reads back as provisional: the maker is the token's own letter", () => {
    const token = encodeOrder(ranks, order, "provisional");
    expect(token).toBe(`O1g-${sequence}`);
    expect(decodeOrder(token!, ranks)).toEqual({ ok: true, origin: "provisional", order });
    expect(decodeOrder(`O1p-${sequence}`, ranks)).toEqual({ ok: true, origin: "planned", order });
  });

  test("indexes follow ascending node ids, whatever order the ranks were made in, and zero ranks are not nodes", () => {
    const reversed = Object.fromEntries(Object.entries(ranks).reverse()) as Ranks;
    expect(encodeOrder(reversed, order, "planned")).toBe(`O1p-${sequence}`);
    expect(encodeOrder({ ...ranks, 5: { rank: 0 } }, order, "planned")).toBe(`O1p-${sequence}`);
    expect(decodeOrder(`O1p-${sequence}`, { ...reversed, 5: { rank: 0 } })).toEqual({ ok: true, origin: "planned", order });
  });

  test("the sequence is the standard base64url alphabet: 64 nodes run from A to _", () => {
    const token = encodeOrder(flat(64), upTo(64), "planned");
    expect(token).toBe("O1p-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_");
    expect(decodeOrder(token!, flat(64))).toEqual({ ok: true, origin: "planned", order: upTo(64) });
  });

  test("64 points is the most a token carries: a bigger build gets no token and a longer token is refused", () => {
    const most: Ranks = { 1: { rank: 50 }, 2: { rank: 14 } };
    const mostOrder = [...Array<number>(50).fill(1), ...Array<number>(14).fill(2)];
    expect(encodeOrder(most, mostOrder, "planned")).toBe(`O1p-${"A".repeat(50)}${"B".repeat(14)}`);
    expect(ORDER_LIMIT).toBe(64);
    const over: Ranks = { 1: { rank: 50 }, 2: { rank: 15 } };
    expect(encodeOrder(over, [...mostOrder, 2], "planned")).toBeNull();
    expect(encodeOrder(flat(65), upTo(65), "planned")).toBeNull();
    expect(decodeOrder(`O1p-${"A".repeat(50)}${"B".repeat(15)}`, over)).toEqual({ ok: false, error: "over-limit" });
    expect(decodeOrder("O1p-A", over)).toEqual({ ok: false, error: "over-limit" });
    expect(decodeOrder(`O1p-${"A".repeat(65)}`, ranks)).toEqual({ ok: false, error: "over-limit" });
  });

  test("a duplicate count fails: a node named more often than its rank, or a node the code does not have", () => {
    expect(decodeOrder(`O1p-${sequence}D`, ranks)).toEqual({ ok: false, error: "extra-points" });
    expect(decodeOrder("O1p-ABABABABABCCCD", ranks)).toEqual({ ok: false, error: "extra-points" });
    expect(decodeOrder("O1p-ABABABABABCDD", ranks)).toEqual({ ok: false, error: "extra-points" });
    expect(decodeOrder("O1p-ABABABABABCCE", ranks)).toEqual({ ok: false, error: "extra-points" });
    expect(decodeOrder("O1p-A", {})).toEqual({ ok: false, error: "extra-points" });
    expect(encodeOrder(ranks, [...order, 32], "planned")).toBeNull();
    expect(encodeOrder(ranks, [...order.slice(0, -1), 99], "planned")).toBeNull();
  });

  test("a missing count fails: a node named less often than its rank, or not at all", () => {
    expect(decodeOrder("O1p-ABABABABABCD", ranks)).toEqual({ ok: false, error: "missing-points" });
    expect(decodeOrder("O1p-ABABABABABCC", ranks)).toEqual({ ok: false, error: "missing-points" });
    expect(encodeOrder(ranks, order.slice(0, -1), "planned")).toBeNull();
    expect(encodeOrder(ranks, [], "planned")).toBeNull();
  });

  test("a bad version fails clearly: O0 and O01 are damaged, O2 and later are newer than this reader", () => {
    expect(decodeOrder(`O0p-${sequence}`, ranks)).toEqual({ ok: false, error: "malformed" });
    expect(decodeOrder(`O01p-${sequence}`, ranks)).toEqual({ ok: false, error: "malformed" });
    expect(decodeOrder(`Oxp-${sequence}`, ranks)).toEqual({ ok: false, error: "malformed" });
    expect(decodeOrder(`O2p-${sequence}`, ranks)).toEqual({ ok: false, error: "newer-version" });
    // A newer version may change everything after its number, so none of it is read as version 1.
    expect(decodeOrder(`O12p-${sequence}`, ranks)).toEqual({ ok: false, error: "newer-version" });
    expect(decodeOrder("O2.anything", ranks)).toEqual({ ok: false, error: "newer-version" });
  });

  test("a mode version 1 does not define is unsupported, never taken for either maker", () => {
    expect(decodeOrder(`O1x-${sequence}`, ranks)).toEqual({ ok: false, error: "unsupported-mode" });
    expect(decodeOrder("O1z-A", {})).toEqual({ ok: false, error: "unsupported-mode" });
  });

  test("a damaged token is refused: no mode, no dash, no points, or characters outside base64url", () => {
    for (const token of ["", "   ", "O", "O1", "O1p", "O1p-", "O1pABABABABABCCD", "O1P-A", "O1pg-A", "O1p-ABAB=", "O1p-AB.AB", "O1p-AB AB", "X1p-A", "o1p-A"]) {
      expect(decodeOrder(token, ranks), token).toEqual({ ok: false, error: "malformed" });
    }
  });

  test("an empty build has no order to carry", () => {
    expect(encodeOrder({}, [], "planned")).toBeNull();
    expect(encodeOrder({ 11: { rank: 0 } }, [], "provisional")).toBeNull();
  });

  test("spaces, tabs and line breaks around a token are ignored, and inside it they damage it", () => {
    expect(decodeOrder(` O1g-${sequence} `, ranks)).toEqual({ ok: true, origin: "provisional", order });
    expect(decodeOrder(`O1p-${sequence}\n`, ranks)).toEqual({ ok: true, origin: "planned", order });
    expect(decodeOrder(`\tO1p-${sequence}\r\n`, ranks)).toEqual({ ok: true, origin: "planned", order });
    expect(decodeOrder(" O1p-ABABA BABABCCD ", ranks)).toEqual({ ok: false, error: "malformed" });
  });

  test("a token with more than one problem gets the first error in the documented order", () => {
    const over: Ranks = { 1: { rank: 50 }, 2: { rank: 15 } };
    // A newer version, whatever follows; then a damaged shape; then the mode; then the limit; then the points.
    expect(decodeOrder("O2p-AB.AB", ranks)).toEqual({ ok: false, error: "newer-version" });
    expect(decodeOrder("O1x-AB.AB", ranks)).toEqual({ ok: false, error: "malformed" });
    expect(decodeOrder(`O1p-${"A".repeat(64)}.`, ranks)).toEqual({ ok: false, error: "malformed" });
    expect(decodeOrder(`O1x-${"A".repeat(65)}`, ranks)).toEqual({ ok: false, error: "unsupported-mode" });
    expect(decodeOrder("O1x-A", over)).toEqual({ ok: false, error: "unsupported-mode" });
    expect(decodeOrder(`O1p-${"A".repeat(65)}`, ranks)).toEqual({ ok: false, error: "over-limit" });
    expect(decodeOrder("O1p-ABABABABABCDD", ranks)).toEqual({ ok: false, error: "extra-points" });
  });
});
