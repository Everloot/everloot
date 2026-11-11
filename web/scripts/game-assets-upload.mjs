// The parts of upload-game-assets.mjs that decide things, kept apart so they are tested without a bucket.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const USAGE = [
  "usage: node scripts/upload-game-assets.mjs <asset folder> [--dry-run] [--skip-items]",
  "   or: node scripts/upload-game-assets.mjs --snapshot <snapshot.sqlite> [--dry-run] [--skip-items]",
].join("\n");

/** Reads the arguments. A flag is never taken for a path: `--snapshot --dry-run` is an error, not a file called "--dry-run". */
export function parseUploadArgs(argv) {
  const out = { dry: false, skipItems: false, snapshot: null, folder: null, error: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dry = true;
    else if (a === "--skip-items") out.skipItems = true;
    else if (a === "--snapshot" || a.startsWith("--snapshot=")) {
      const value = a.includes("=") ? a.slice(a.indexOf("=") + 1) : argv[i + 1];
      if (!value || value.startsWith("--")) return { ...out, error: "--snapshot needs the path of a snapshot file" };
      out.snapshot = value;
      if (!a.includes("=")) i++;
    } else if (a.startsWith("--")) return { ...out, error: `unknown option ${a}` };
    else if (out.folder) return { ...out, error: `one folder only, not also ${a}` };
    else out.folder = a;
  }
  if (out.snapshot && out.folder) return { ...out, error: "give a snapshot or a folder, not both" };
  if (!out.snapshot && !out.folder) return { ...out, error: "nothing to upload" };
  return out;
}

/** The public bucket gets WebP images and the manifest, nothing else: no item data. */
export const isPublicFile = (rel) => rel === "manifest.json" || (/\.webp$/.test(rel) && !rel.startsWith("items/"));
/** The private bucket gets the item index and its shards only. */
export const isPrivateFile = (rel) => rel === "items.json" || /^items\/\d+\.json$/.test(rel);

export function walk(base, prefix = "") {
  return readdirSync(join(base, prefix)).flatMap((name) => {
    const rel = prefix ? `${prefix}/${name}` : name;
    return statSync(join(base, rel)).isDirectory() ? walk(base, rel) : [rel];
  });
}

const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

/**
 * What is wrong with a folder against its list of files and hashes: a file missing, one not listed, a
 * hash that differs, a file of a kind that may not go to this bucket. `index` is the file that holds the
 * list; it and `skip` (checksums.json, which stays local) are not checked as data files.
 * @param {string} root
 * @param {Map<string, string>} expected
 * @param {{ index: string, allowed: (rel: string) => boolean, skip?: string[] }} opts
 */
export function folderProblems(root, expected, { index, allowed, skip = [] }) {
  const present = walk(root).filter((f) => f !== index && !skip.includes(f));
  const problems = [];
  for (const f of present) if (!expected.has(f)) problems.push(`not listed: ${f}`);
  for (const [f, hash] of expected) {
    if (!present.includes(f)) problems.push(`missing: ${f}`);
    else if (sha(join(root, f)) !== hash) problems.push(`hash differs: ${f}`);
  }
  for (const f of [...present, index]) if (!allowed(f)) problems.push(`may not go to this bucket: ${f}`);
  return { present, problems };
}

/**
 * The shown-names files (`npm run kb -- item-names` and `game-names`), each with its schema and whether it carries
 * names from the Warcraft Wiki.
 */
export const NAME_FILES = {
  "wiki-npc-names.json": { schema: "everloot.wiki-npc-names/2", wiki: true },
  "wiki-spell-names.json": { schema: "everloot.wiki-spell-names/1", wiki: true },
  "item-names.json": { schema: "everloot.item-names/1", wiki: true },
  "quest-names.json": { schema: "everloot.quest-names/1", wiki: true },
  "item-set-names.json": { schema: "everloot.item-set-names/1", wiki: false },
  "spell-names.json": { schema: "everloot.spell-names/1", wiki: false },
};

/**
 * The build folder a shown-names file goes under in the private bucket, from the folder it was written to
 * (`<build folder>-names`), and what is wrong with the file. Nothing wrong: `problems` is empty.
 * `live` is the folder the site reads, the last part of NEXT_PUBLIC_GAME_ASSETS_URL, when a re-extract of the
 * same build was uploaded under another name (`<build folder>-2`); another build's folder is refused.
 * @param {string | null} [live]
 */
export function namesFileCheck(json, folderName, fileName = "item-names.json", live = null) {
  const problems = [];
  const built = /^([A-Za-z0-9_.-]+)-names$/.exec(folderName)?.[1] ?? null;
  if (!built) problems.push(`the file is not in a <build folder>-names folder (${folderName})`);
  const sameBuild = live !== null && built !== null && /^[A-Za-z0-9_.-]+$/.test(live) && (live === built || live.startsWith(`${built}-`));
  if (live !== null && built && !sameBuild) problems.push(`--folder ${live} is not a folder of build ${built}`);
  const prefix = live !== null ? (sameBuild ? live : null) : built;
  const kind = Object.hasOwn(NAME_FILES, fileName) ? NAME_FILES[fileName] : null;
  if (!kind) problems.push(`${fileName} is not a names file (${Object.keys(NAME_FILES).join(", ")})`);
  else if (json?.schema !== kind.schema) problems.push(`schema is ${json?.schema}, expected ${kind.schema}`);
  if (typeof json?.build?.version !== "string") problems.push("no build version");
  if (kind?.wiki && json?.wiki?.licence !== "CC-BY-SA-4.0") problems.push("the wiki source is not CC-BY-SA-4.0");
  const names = json?.names && typeof json.names === "object" ? Object.keys(json.names) : null;
  if (!names) problems.push("no names");
  else if (names.length !== json.count) problems.push(`count is ${json.count} but the file holds ${names.length} names`);
  return { prefix, problems };
}

/** Upload order: the data files, then the index last, so a half-finished upload never lists a file that is not there. */
export const uploadOrder = (files, index) => [...files.filter((f) => f !== index), index];

/** Runs `fn` up to `tries` times, waiting 1 s, 2 s, 4 s... between tries. Throws the last error. */
export async function withRetry(fn, { tries = 4, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn(i);
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(1000 * 2 ** i);
    }
  }
  throw last;
}
