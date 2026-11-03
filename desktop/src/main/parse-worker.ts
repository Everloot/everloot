// The save reader's worker thread (dist/parse-worker.cjs): parses account files for the main thread and answers with
// small results only. Requests are handled one at a time, in order. See save-reader.ts.
import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { parentPort } from "node:worker_threads";
import { parseEverlootLua, type EverlootFile } from "../../../web/src/lib/sv-parse";
import { factsFrom, writeKey } from "./save-facts";
import { toWire, type FactsValue, type ReaderReply, type ReaderRequest, type UploadHead } from "./save-reader";

/** The last facts per file, by write: a second ask for the same write is not parsed again. */
const facts = new Map<string, FactsValue>();
/** The upload's parse per file, from its first request until it takes the unsent rows. */
const uploads = new Map<string, { key: string; parsed: EverlootFile }>();

function handle(r: ReaderRequest): unknown {
  if (r.op === "facts") {
    const key = writeKey(r.file);
    const hit = facts.get(r.file);
    if (hit?.key === key) return hit;
    const text = readFileSync(r.file, "utf8");
    let value: FactsValue;
    try { value = { key, facts: factsFrom(text) }; } catch (err) { value = { key, error: toWire(err) }; }
    facts.set(r.file, value);
    return value;
  }
  if (r.op === "upload") {
    // One open for the write time and the text, and the same open error readFileSync(file) gives.
    const fd = openSync(r.file, "r");
    let key: string, text: string;
    try { const st = fstatSync(fd); key = `${st.mtimeMs}:${st.size}`; text = readFileSync(fd, "utf8"); } finally { closeSync(fd); }
    const parsed = parseEverlootLua(text);
    uploads.set(r.file, { key, parsed });
    const head: UploadHead = { key, version: parsed.version, installId: parsed.installId, clientBuild: parsed.clientBuild, eventIds: parsed.records.map((x) => (typeof x.eventId === "string" ? x.eventId : null)) };
    if (head.clientBuild === undefined) delete head.clientBuild;
    return head;
  }
  // The rows the upload still needs; null when its parse is gone, and the upload reads the file itself.
  const u = uploads.get(r.file);
  if (!u || u.key !== r.key) return null;
  uploads.delete(r.file);
  return r.indices.map((i) => u.parsed.records[i]);
}

parentPort?.on("message", (r: ReaderRequest) => {
  let reply: ReaderReply;
  try { reply = { id: r.id, ok: true, value: handle(r) }; } catch (err) { reply = { id: r.id, ok: false, error: toWire(err) }; }
  parentPort?.postMessage(reply);
});
