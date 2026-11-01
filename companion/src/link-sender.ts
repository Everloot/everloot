import { readFileSync } from "node:fs";
import { LINK_KINDS, recordSchemas } from "@everloot/protocol";
import { parseEverlootLua } from "../../web/src/lib/sv-parse";
import { receiptKeyForSite, type SentState } from "./sent-state";

/**
 * Sends the character_link rows `/everloot link <code>` wrote to the account's own link endpoint,
 * POST /api/me/characters/links, with the account key, and nowhere else. The upload never carries them
 * (web/src/lib/upload-batches.ts holds them out), and this module never calls the intake.
 *
 * A row is marked handled once the site answered it: linked, frozen or refused. A row to send again, or a request
 * that failed, stays unsent for the next run. Without a key nothing is sent and the rows wait.
 */

export interface LinkSendOptions {
  /** Site origin, e.g. https://everloot.app. */
  endpoint: string;
  /** The account key (evl_...) checked against this site, or null when the app is not signed in to it. */
  key: string | null;
  state: SentState;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface LinkSendResult {
  linked: string[];
  frozen: string[];
  refused: string[];
  /** Rows not sent or not answered this run: they go again next run. */
  waiting: number;
  /** Why rows wait, when the whole request did not go through. */
  problem: string | null;
}

/** Rows one request may carry: the endpoint's LINK_ROWS_PER_REQUEST. */
const PER_REQUEST = 10;

/** Handled link rows are kept apart from the intake's receipts, under their own key. */
export const linkReceiptKey = (installId: string, endpoint: string) => `links|${receiptKeyForSite(installId, endpoint)}`;

type Answer = { index?: unknown; status?: unknown; name?: unknown; realm?: unknown; message?: unknown };

/** Why a whole request was turned away, in the site's own words when it gave some. */
function problemOf(status: number, said: string): string {
  if (status === 401) return "everloot.app refused your account key; it may have been revoked. Sign in again under Settings > Account.";
  if (status === 403) return said || "Your account key cannot link characters. Sign in again under Settings > Account.";
  if (status === 404) return "Character links are not switched on at everloot.app yet. The codes stay in your file.";
  if (status === 429) return said || "everloot.app asked to wait. The codes go again next time.";
  return said ? `${said} (HTTP ${status})` : `everloot.app could not link characters right now (HTTP ${status}). The codes go again next time.`;
}

export async function sendLinks(file: string, options: LinkSendOptions): Promise<LinkSendResult> {
  const parsed = parseEverlootLua(readFileSync(file, "utf8"));
  const receiptKey = linkReceiptKey(parsed.installId, options.endpoint);
  const result: LinkSendResult = { linked: [], frozen: [], refused: [], waiting: 0, problem: null };
  const rows: { eventId: string; record: unknown }[] = [];
  const bad: string[] = [];
  for (const r of parsed.records) {
    if (!LINK_KINDS.includes(String(r.kind)) || typeof r.eventId !== "string" || options.state.has(receiptKey, r.eventId)) continue;
    const row = recordSchemas.character_link.safeParse(r);
    // A row the endpoint would refuse is not sent; it is marked handled so it is not weighed again.
    if (!row.success) { bad.push(r.eventId); result.refused.push("a link row the site would not read"); continue; }
    rows.push({ eventId: r.eventId, record: row.data });
  }
  if (bad.length) options.state.add(receiptKey, bad);
  if (!rows.length) return result;
  if (!options.key) {
    result.waiting = rows.length;
    result.problem = "Sign in to your account under Settings > Account to link these characters.";
    return result;
  }
  const url = new URL("/api/me/characters/links", options.endpoint).href;
  const send = options.fetch ?? fetch;
  for (let start = 0; start < rows.length; start += PER_REQUEST) {
    const batch = rows.slice(start, start + PER_REQUEST);
    let response: Response, body: { results?: unknown; error?: unknown } | null;
    try {
      response = await send(url, {
        method: "POST",
        headers: { authorization: `Bearer ${options.key}`, "content-type": "application/json", "user-agent": "everloot-desktop" },
        body: JSON.stringify({ records: batch.map((r) => r.record) }),
        redirect: "error",
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });
      body = await response.json().catch(() => null);
    } catch {
      result.waiting += rows.length - start;
      result.problem = "Could not reach everloot.app to link characters. The codes go again next time.";
      return result;
    }
    const answers = Array.isArray(body?.results) ? (body.results as Answer[]) : null;
    if (!answers || (response.status !== 200 && response.status !== 503)) {
      result.waiting += rows.length - start;
      result.problem = problemOf(response.status, typeof body?.error === "string" ? body.error.replace(/\s+/g, " ").trim().slice(0, 300) : "");
      return result;
    }
    const handled: string[] = [];
    batch.forEach((row, index) => {
      const answer = answers.find((a) => a?.index === index);
      const who = typeof answer?.name === "string" && typeof answer.realm === "string" ? `${answer.name} of ${answer.realm}` : "a character";
      const message = typeof answer?.message === "string" ? answer.message.replace(/\s+/g, " ").trim().slice(0, 300) : "";
      if (answer?.status === "linked") { result.linked.push(who); handled.push(row.eventId); }
      else if (answer?.status === "frozen") { result.frozen.push(who); handled.push(row.eventId); }
      else if (answer?.status === "refused") { result.refused.push(message || "refused"); handled.push(row.eventId); }
      else result.waiting++;
    });
    if (handled.length) options.state.add(receiptKey, handled);
  }
  return result;
}

/** One line for the app's status: what happened to each link row this run, or null when there were none. */
export function linkSummary(r: LinkSendResult): string | null {
  const parts = [
    r.linked.length ? `linked ${r.linked.join(", ")}` : "",
    r.frozen.length ? `${r.frozen.join(", ")} frozen: another account linked ${r.frozen.length === 1 ? "it" : "them"} too` : "",
    r.refused.length ? `${r.refused.length} link ${r.refused.length === 1 ? "code" : "codes"} refused (${[...new Set(r.refused)].join(" ")})` : "",
    r.waiting ? `${r.waiting} link ${r.waiting === 1 ? "code waits" : "codes wait"}${r.problem ? `: ${r.problem}` : ""}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : null;
}
