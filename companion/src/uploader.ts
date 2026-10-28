import { readFileSync } from "node:fs";
import { UPLOAD_LIMITS, type RecordKind } from "@everloot/protocol";
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
  /** How long one batch may take, its answer included, before it counts as failed. One minute by default. */
  timeoutMs?: number;
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

/** An answer past the largest request the intake takes is not a receipt. */
const MAX_ANSWER_BYTES = UPLOAD_LIMITS.maxBodyBytes;
const KEEP = "Nothing more was marked sent; keep your file and retry.";

/** Milliseconds a Retry-After header asks for, in seconds or as a date; 0 when it says nothing usable. */
function retryAfterMs(value: string | null): number {
  if (!value) return 0;
  const ms = Number.isFinite(Number(value)) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return ms > 0 ? ms : 0;
}

/** Reads the whole answer, or null when it runs past `MAX_ANSWER_BYTES`. */
async function readAnswer(reader: ReadableStreamDefaultReader<Uint8Array> | undefined): Promise<string | null> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_ANSWER_BYTES) { void reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Turns an answer `sendBatches` could not use into an error that says what happened: a refusal by its status and the
 * site's own short reason, a rate limit with its wait, a page that is no receipt. The page itself is never repeated.
 */
function refusal(response: Response, text: string | null, site: string): Error | null {
  let body: unknown;
  try { body = text === null ? undefined : JSON.parse(text); } catch { body = undefined; }
  const error = (body as { error?: unknown } | undefined)?.error;
  const said = typeof error === "string" ? error.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  if (response.status === 429) {
    const wait = retryAfterMs(response.headers.get("retry-after"));
    return new Error(`${said || `${site} rate limited this upload. Keep your file.`}${wait ? ` Try again in ${Math.max(1, Math.round(wait / 60_000))} min.` : ""}`);
  }
  if (!response.ok) {
    if (said) return new Error(`${said} (HTTP ${response.status})`);
    return new Error(response.status >= 500
      ? `${site} had a server error (HTTP ${response.status}). ${KEEP}`
      : `${site} refused the upload (HTTP ${response.status}). ${KEEP}`);
  }
  if (!body || typeof body !== "object") return new Error(`${site} answered with something that is not an Everloot receipt (HTTP ${response.status}). Check the site address and any network sign-in page. ${KEEP}`);
  return null;
}

/**
 * `send` with a time limit on each request, its answer included, and plain errors for what `sendBatches` could not
 * read. A usable answer goes on unchanged: `sendBatches` still checks the receipt before anything is marked sent.
 */
function bounded(send: typeof fetch, site: string, timeoutMs: number): typeof fetch {
  return async (url, init) => {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Aborting stops a real fetch and its body; cancelling the reader stops a body that ignores the signal.
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${site} did not answer within ${Math.round(timeoutMs / 1000)} s. ${KEEP}`));
        controller.abort();
        void reader?.cancel().catch(() => {});
      }, timeoutMs);
    });
    try {
      const response = await Promise.race([send(url, { ...init, signal: controller.signal }).catch((err: unknown) => {
        const code = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
        throw new Error(`Could not reach ${site}${typeof code === "string" ? ` (${code})` : ""}. ${KEEP}`);
      }), late]);
      reader = response.body?.getReader();
      const text = await Promise.race([readAnswer(reader), late]);
      const error = refusal(response, text, site);
      if (error) throw error;
      return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
    } finally {
      clearTimeout(timer);
    }
  };
}

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
  const send = bounded(options.fetch ?? fetch, new URL(options.endpoint).host, options.timeoutMs ?? 60_000);
  await sendBatches(session, send, () => {
    const confirmed = JSON.parse(session.batches[session.next - 1]).records as { eventId: string }[];
    options.state.add(receiptKey, confirmed.map((r) => r.eventId));
    result.sent += confirmed.length;
  }, new URL("/api/intake", options.endpoint).href);
  return result;
}
