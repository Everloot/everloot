import { describe, expect, test } from "vitest";
import {
  ALL_RECORD_KINDS, CENSUS_KINDS, censusSeenStored, censusSelfStored, parseRecords, PUBLIC_RECORD_KINDS, recordSchemas,
} from "../src/index.js";
import { recordSchema } from "../scripts/emit-schema.js";

const base = { installId: "test-install-1234", capturedAt: "2026-10-18T21:30:00.000Z", eventId: "census:1" };
const self = { ...base, kind: "census_self", guid: "Player-4395-0A1B2C3D", race: "Scourge", class: "PRIEST", level: 24, faction: "Horde", realm: "Forever" };
const seen = { ...base, kind: "census_seen", guid: "Player-4395-0F00BA44", race: "Skyborne", class: "HUNTER", level: 60, faction: "Alliance", via: "mouseover" };

const reasons = (rows: unknown[]) => parseRecords(rows).receipt.rejected.map((r) => r.reason);

describe("census records", () => {
  test("both kinds are record kinds, and neither is a public corpus kind", () => {
    expect(CENSUS_KINDS).toEqual(["census_self", "census_seen"]);
    for (const kind of CENSUS_KINDS) {
      expect(ALL_RECORD_KINDS).toContain(kind);
      expect(PUBLIC_RECORD_KINDS).not.toContain(kind);
    }
  });

  test("the schema the addon reads holds exactly the contract's patterns", () => {
    for (const kind of CENSUS_KINDS) {
      const { properties } = recordSchema(kind as "census_self" | "census_seen") as { properties: Record<string, { pattern?: string; maxLength?: number }> };
      expect(properties.guid).toMatchObject({ pattern: "^Player-[1-9]\\d*-[0-9A-F]+$" });
      expect(properties.guid.maxLength).toBeUndefined();
      expect(properties.race.pattern).toBe("^[A-Za-z]{2,24}$");
      expect(properties.class.pattern).toBe("^[A-Z]{3,16}$");
    }
  });

  test("your own character and a player you see parse as sent", () => {
    const parsed = parseRecords([self, seen]);
    expect(parsed.receipt.rejected).toEqual([]);
    expect(parsed.records).toEqual([self, seen]);
  });

  test("any race token parses, so a race the list does not know yet is not refused", () => {
    for (const race of ["Human", "NightElf", "Scourge", "Skyborne", "BloodElf"]) {
      expect(reasons([{ ...seen, race }])).toEqual([]);
    }
    expect(reasons([{ ...seen, race: "Night Elf" }])).toHaveLength(1);
    expect(reasons([{ ...seen, race: "X" }])).toHaveLength(1);
  });

  test("a class is an upper-case class token", () => {
    expect(reasons([{ ...seen, class: "DRUID" }])).toEqual([]);
    expect(reasons([{ ...seen, class: "Druid" }])).toHaveLength(1);
    expect(reasons([{ ...seen, class: "DK" }])).toHaveLength(1);
  });

  test("a level outside 1..60 or a fraction is refused", () => {
    for (const level of [0, 61, 24.5, -1]) expect(reasons([{ ...self, level }]), String(level)).toHaveLength(1);
    expect(reasons([{ ...self, level: 1 }, { ...self, level: 60 }])).toEqual([]);
  });

  test("a faction is Alliance or Horde, spelled as the game spells it", () => {
    for (const faction of ["alliance", "Neutral", ""]) expect(reasons([{ ...seen, faction }]), faction).toHaveLength(1);
  });

  test("a GUID must be a player GUID", () => {
    for (const guid of ["Creature-0-4395-0-12-1234-0000ABCD", "Player-4395-0a1b2c3d", "Player--0A1B", "Player-04395-0A1B", "Player-0-0A1B", "Thrall", ""]) {
      expect(reasons([{ ...seen, guid }]), guid).toHaveLength(1);
    }
    const { guid: _, ...noGuid } = seen;
    expect(reasons([noGuid])).toHaveLength(1);
  });

  test("realm comes only with your own character, and via only with a player you see", () => {
    expect(reasons([{ ...seen, realm: "Forever" }])).toEqual(["realm is sent only for your own characters"]);
    expect(reasons([{ ...self, via: "target" }])).toEqual(["via is sent only for players you see"]);
    const { realm: _, ...selfNoRealm } = self;
    expect(reasons([selfNoRealm])).toHaveLength(1);
    const { via: __, ...seenNoVia } = seen;
    expect(reasons([seenNoVia])).toHaveLength(1);
    expect(reasons([{ ...seen, via: "inspect" }])).toHaveLength(1);
  });

  test("via is target, mouseover, group or nameplate, and nothing else", () => {
    for (const via of ["target", "mouseover", "group", "nameplate"]) expect(reasons([{ ...seen, via }]), via).toEqual([]);
    for (const via of ["inspect", "who", "Nameplate", "nameplate1", "", 1]) expect(reasons([{ ...seen, via }]), String(via)).toHaveLength(1);
    const { properties } = recordSchema("census_seen") as { properties: Record<string, { enum?: string[] }> };
    expect(properties.via.enum).toEqual(["target", "mouseover", "group", "nameplate"]);
  });

  test("a realm is a realm name, as in the other realm fields", () => {
    for (const realm of ["visit scam.example/<b>", "a", "x".repeat(41), "  ", "Forever\nGuild"]) expect(reasons([{ ...self, realm }]), realm).toHaveLength(1);
    expect(reasons([{ ...self, realm: "Mal'Ganis" }, { ...self, realm: "Azjol-Nerub" }])).toEqual([]);
  });

  test("a name, guild or position sent along is dropped, never kept", () => {
    const parsed = parseRecords([{ ...seen, name: "Thrall", guild: "Horde Raiders", x: 41.2, y: 66.1, mapId: 1454 }]);
    expect(parsed.receipt.rejected).toEqual([]);
    expect(parsed.records).toEqual([seen]);
  });
});

describe("stored census rows", () => {
  const characterKey = "a".repeat(64);
  const stored = { installId: base.installId, capturedAt: base.capturedAt, kind: "census_seen", eventId: `census_seen:2026-10-18:${"a".repeat(24)}`,
    characterKey, serverId: 4395, race: "Skyborne", class: "HUNTER", level: 60, faction: "Alliance", via: "mouseover" };

  test("a stored row has a character key and server id in place of the GUID", () => {
    expect(censusSeenStored.parse(stored)).toEqual(stored);
    expect(censusSeenStored.parse({ ...stored, guid: "Player-4395-0F00BA44" })).not.toHaveProperty("guid");
  });

  test("a stored row may carry the keyed address hash, 16 hex and nothing else", () => {
    expect(censusSeenStored.parse({ ...stored, reporter: "0123456789abcdef" })).toMatchObject({ reporter: "0123456789abcdef" });
    for (const reporter of ["203.0.113.9", "0123456789ABCDEF", "abc"]) expect(censusSeenStored.safeParse({ ...stored, reporter }).success, reporter).toBe(false);
    expect(censusSeenStored.safeParse(stored).success).toBe(true);
  });

  test("a stored row keeps a nameplate via and refuses an unknown one", () => {
    expect(censusSeenStored.parse({ ...stored, via: "nameplate" })).toMatchObject({ via: "nameplate" });
    expect(censusSeenStored.safeParse({ ...stored, via: "inspect" }).success).toBe(false);
  });

  test("a stored row needs the server's event id and a full-length key", () => {
    expect(censusSeenStored.safeParse({ ...stored, eventId: "census:1" }).success).toBe(false);
    expect(censusSeenStored.safeParse({ ...stored, eventId: `census_self:2026-10-18:${"a".repeat(24)}` }).success).toBe(false);
    expect(censusSeenStored.safeParse({ ...stored, characterKey: "a".repeat(8) }).success).toBe(false);
    const { via: _, ...common } = stored;
    expect(censusSelfStored.safeParse({ ...common, kind: "census_self", eventId: `census_self:2026-10-18:${"a".repeat(24)}`, realm: "Forever" }).success).toBe(true);
  });

  test("the wire schemas are what the addon validates against; stored rows are not a record kind", () => {
    expect(Object.keys(recordSchemas)).not.toContain("census_seen_stored");
    expect(recordSchemas.census_seen.safeParse(stored).success).toBe(false);
  });
});
