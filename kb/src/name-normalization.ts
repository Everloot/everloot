/** The item/wiki comparison rule, shared with website NPC name agreement. */
export const normName = (s: string) => s.normalize("NFC").replace(/[‘’`]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
