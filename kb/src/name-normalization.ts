/** The item/wiki comparison rule, shared with website NPC name agreement. */
export const normName = (s: string) => s.normalize("NFC").replace(/[\u2018\u2019`]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
