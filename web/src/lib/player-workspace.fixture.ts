// A version 2 bucket as the alt planner writes it: one plan, and one alt with the details version 2 added (realm,
// class, faction, level, professions and where they came from). Tests use it to check that a build which reads
// version 2 keeps every field of it, byte for byte, when it changes something else.

export const FIXTURE_PLAN_ID = "1a2b3c4d-0000-4000-8000-000000000001";
export const FIXTURE_ALT_ID = "1a2b3c4d-0000-4000-8000-000000000500";

export const V2_PLAN_TEXT = `{"id":"${FIXTURE_PLAN_ID}","name":"Frost","classSlug":"mage",`
  + `"code":"EL1-mage-1482-1.60.1.70450-OTAwMDE6Miw5MDAwMjoxOjEsOTAwMDQ6Mg","code2":null,"order":"O1p-AABCC","order2":null,`
  + `"notes":"","updatedAt":"2026-10-20T12:00:00.000Z","boundTo":null}`;

export const V2_ALT_TEXT = `{"id":"${FIXTURE_ALT_ID}","name":"Thrall","realm":"Moon Guard","classSlug":"shaman","faction":"horde",`
  + `"level":24,"professions":["Alchemy","First Aid"],"notes":"Bank alt.\\nTuesdays.","planIds":["${FIXTURE_PLAN_ID}"],`
  + `"provenance":{"source":"addon-file","fileRecordAt":"2026-10-21T18:00:00.000Z","fileDetails":["classSlug","level","faction"]},`
  + `"updatedAt":"2026-10-22T09:30:00.000Z"}`;

/** The signed-out bucket's stored text. */
export const V2_BUCKET_TEXT = `{"format":"everloot.player-workspace","version":2,"owner":{"kind":"anonymous"},`
  + `"plans":[${V2_PLAN_TEXT}],"alts":[${V2_ALT_TEXT}],"watches":[]}`;
