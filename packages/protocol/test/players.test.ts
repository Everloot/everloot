import { describe, expect, test } from "vitest";
import { ALL_RECORD_KINDS, parseRecords, PLAYER_KINDS, PUBLIC_RECORD_KINDS, validGuildName, validPlayerName } from "../src/index.js";

const row = {
  installId: "test-install-1234", capturedAt: "2026-10-20T21:30:00.000Z", eventId: "player_seen:1",
  kind: "player_seen", name: "Thrallina", realm: "Forever Pioneer", race: "Orc", class: "SHAMAN", level: 24, guild: "Night Watch",
};

const reasons = (rows: unknown[]) => parseRecords(rows).receipt.rejected.map((r) => r.reason);

describe("player_seen records", () => {
  test("a Forever surname is retained for armory discovery while legacy rows still parse", () => {
    const full = { ...row, surname: "Morningstar" };
    expect(parseRecords([full, row]).records).toEqual([full, row]);
    expect(parseRecords([{ ...row, surname: "Two Words" }]).receipt.rejected).toHaveLength(1);
  });
  test("it is a record kind and not a public corpus kind", () => {
    expect(PLAYER_KINDS).toEqual(["player_seen"]);
    expect(ALL_RECORD_KINDS).toContain("player_seen");
    expect(PUBLIC_RECORD_KINDS).not.toContain("player_seen");
  });

  test("a row with and without a guild parses as sent", () => {
    const { guild: _guild, ...noGuild } = row;
    const parsed = parseRecords([row, noGuild]);
    expect(parsed.receipt.rejected).toEqual([]);
    expect(parsed.records).toEqual([row, noGuild]);
  });

  test("names are letters only, 2 to 12, in any script", () => {
    for (const name of ["Ab", "Ñandú", "Zhāng", "Abcdefghijkl"]) expect(validPlayerName(name)).toBe(true);
    for (const name of ["A", "Abcdefghijklm", "Bob1", "Two Words", "a-b", "", "<b>x</b>"]) expect(validPlayerName(name)).toBe(false);
    expect(reasons([{ ...row, name: "Bob1" }])).toHaveLength(1);
  });

  test("guild names allow letters, digits, spaces, apostrophes and hyphens, up to 24", () => {
    for (const guild of ["Ab", "Night Watch", "Knights of the 9th", "O'Neil-Clan"]) expect(validGuildName(guild)).toBe(true);
    for (const guild of ["A", "x".repeat(25), " Leading", "Bad<tag>", "http://spam.example"]) expect(validGuildName(guild)).toBe(false);
  });

  test("a level outside 1 to 60, an unknown field value or a missing field is refused", () => {
    expect(reasons([{ ...row, level: 0 }])).toHaveLength(1);
    expect(reasons([{ ...row, level: 61 }])).toHaveLength(1);
    expect(reasons([{ ...row, class: "hunter" }])).toHaveLength(1);
    const { realm: _realm, ...noRealm } = row;
    expect(reasons([noRealm])).toHaveLength(1);
  });

  test("the row has no place for a GUID, a position or gear: they are dropped, not stored", () => {
    const parsed = parseRecords([{ ...row, guid: "Player-1-ABC", x: 1, y: 2, gear: [1] }]);
    expect(parsed.receipt.rejected).toEqual([]);
    expect(Object.keys(parsed.records[0]).sort()).toEqual(Object.keys(row).sort());
  });
});
