import { readFileSync } from "node:fs";
import type { RecordKind } from "@everloot/protocol";
import { parseEverlootLua } from "../../web/src/lib/sv-parse";
import { prepareUpload, sendBatches } from "../../web/src/lib/upload-batches";
import { settledSkip, type SettledList } from "../../kb/src/settled-list";
import { receiptKeyForSite, type SentState } from "./sent-state";

export interface UploadOptions {
  /** Site origin, e.g. https://everloot.app. */
  endpoint: string;
  fetch?: typeof fetch;
  state: SentState;
  /** The player allowed census counts in the Desktop App; without it the census waits for the upload page. */
  census?: boolean;
  /** The player allowed the player pages in the Desktop App; without it they wait for the upload page. */
  players?: boolean;
  /**
   * The settled list for the file's build (`/api/coverage/settled`), or a function that loads it for a build. Rows
   * whose fact is settled are left out and marked handled; without a list, or for another build, nothing is skipped.
   */
  settled?: SettledList | null | ((build: string | undefined) => Promise<SettledList | null>);
}

/** Installed addon lists go only from the upload page, after its preview; the companion never sends them. */
const ADDON_LIST: RecordKind = "addon_seen";
/**
 * The census goes from the upload page, which shows its counts first, or from the Desktop App when the
 * player allowed it on the app's setup screen or in its settings. The kinds are plain strings because
 * the census intake change adds them to @everloot/protocol.
 */
const CENSUS = new Set<string>(["census_self", "census_seen"]);

/** Named player rows go only from the upload page too, which says what they are first. */
const PLAYERS: RecordKind = "player_seen";

export interface UploadResult { sent: number; batches: number; skipped: number; heldNamed: number; heldLegacy: number; heldAddons: number; heldCensus: number; heldPlayers: number; invalid: number }

/**
 * Send one SavedVariables file's unsent events, the same way the upload page does: named categories
 * stay on this machine (no sharing choices, no grants), and progress advances only on a confirmed receipt.
 * The installed addon list and player rows stay here too: they are sent only from the upload page, after its preview.
 * The census stays here too unless `census` is set.
 */
export async function uploadFile(file: string, options: UploadOptions): Promise<UploadResult> {
  const parsed = parseEverlootLua(readFileSync(file, "utf8"));
  const receiptKey = receiptKeyForSite(parsed.installId, options.endpoint);
  const unsent = parsed.records.filter((r) => typeof r.eventId !== "string" || !options.state.has(receiptKey, r.eventId));
  const held = (r: Record<string, unknown>) => !options.census && CENSUS.has(String(r.kind));
  const heldCensus = unsent.filter(held).length;
  const heldPlayer = (r: Record<string, unknown>) => !options.players && r.kind === PLAYERS;
  const heldPlayers = unsent.filter(heldPlayer).length;
  const records = unsent.filter((r) => r.kind !== ADDON_LIST && !heldPlayer(r) && !held(r));
  const list = typeof options.settled === "function" ? await options.settled(parsed.clientBuild) : options.settled;
  const session = prepareUpload({ addonVersion: parsed.version, clientBuild: parsed.clientBuild, records }, {}, [], undefined, settledSkip(list, parsed.clientBuild));
  // A settled row is handled: it is not weighed again next time, whether or not the rest is sent.
  if (session.skipped.length) options.state.add(receiptKey, session.skipped);
  const result = { sent: 0, batches: session.batches.length, skipped: session.skipped.length, heldNamed: session.held.named, heldLegacy: session.held.legacy,
    heldAddons: unsent.length - records.length - heldCensus - heldPlayers, heldCensus, heldPlayers, invalid: session.held.invalid };
  if (session.batches.length === 0) return result;
  await sendBatches(session, options.fetch ?? fetch, () => {
    const confirmed = JSON.parse(session.batches[session.next - 1]).records as { eventId: string }[];
    options.state.add(receiptKey, confirmed.map((r) => r.eventId));
    result.sent += confirmed.length;
  }, new URL("/api/intake", options.endpoint).href);
  return result;
}
