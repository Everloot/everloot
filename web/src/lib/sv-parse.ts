/**
 * Minimal SavedVariables parser for EverlootDB exports.
 * Handles the Lua subset our addon writes: nested tables, 1-indexed arrays,
 * strings (quoted + long-bracket), numbers, booleans, nil (skipped).
 * Anything outside the subset throws — never silently misreads a file.
 */

export type LuaValue = string | number | boolean | LuaTable;
export interface LuaTable {
  array: LuaValue[];
  map: Map<string, LuaValue>;
}

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/y;

export class LuaParseError extends Error {}

class Parser {
  private i = 0;
  /** `root` is the global the file assigns; `what` names the file in the error when it is missing. */
  constructor(private readonly s: string, private readonly root = "EverlootDB", private readonly what = "an Everloot export") {}

  parse(): LuaTable {
    // EverlootDB = { ... } (or the root given) — find the assignment, parse the table.
    const m = new RegExp(`${this.root}\\s*=\\s*`).exec(this.s);
    if (!m) throw new LuaParseError(`not ${this.what} (${this.root} = {...} not found)`);
    this.start = m.index;
    this.i = m.index + m[0].length;
    const v = this.value();
    if (typeof v !== "object" || v === null || !("array" in v)) {
      throw new LuaParseError(`${this.root} is not a table`);
    }
    return v as LuaTable;
  }

  /** Where the assignment parse found begins. */
  private start = 0;

  /**
   * As parse, for a file that is that one assignment and nothing else, as the game writes it: whitespace and comments
   * around it and at most a semicolon after it. A file holding anything more is not read at all.
   */
  parseWhole(): LuaTable {
    const table = this.parse();
    const end = this.i;
    // Only whitespace and comments before the assignment, ending where it begins (not one inside a comment).
    this.i = 0;
    this.ws();
    if (this.i !== this.start) throw new LuaParseError(`extra text before ${this.root}`);
    this.i = end;
    this.ws();
    if (this.s[this.i] === ";") { this.i++; this.ws(); }
    if (this.i < this.s.length) throw new LuaParseError(`extra text after ${this.root} at offset ${this.i}`);
    return table;
  }

  private ws(): void {
    while (this.i < this.s.length) {
      const c = this.s[this.i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") this.i++;
      else if (c === "-" && this.s[this.i + 1] === "-") {
        while (this.i < this.s.length && this.s[this.i] !== "\n") this.i++;
      } else break;
    }
  }

  private value(): LuaValue {
    this.ws();
    const c = this.s[this.i];
    if (c === "{") return this.table();
    if (c === '"' || c === "'") return this.quoted();
    if (c === "[" && this.s[this.i + 1] === "[") return this.longString();
    if (c === "t" && this.s.startsWith("true", this.i)) { this.i += 4; return true; }
    if (c === "f" && this.s.startsWith("false", this.i)) { this.i += 5; return false; }
    if (c === "n" && this.s.startsWith("nil", this.i)) { this.i += 3; return "__nil__" as unknown as LuaValue; }
    const num = /-?\d+(\.\d+)?([eE][+-]?\d+)?/y;
    num.lastIndex = this.i;
    const m = num.exec(this.s);
    if (m) { this.i += m[0].length; return Number(m[0]); }
    throw new LuaParseError(`unexpected token at offset ${this.i}: ${this.s.slice(this.i, this.i + 20)}`);
  }

  private quoted(): string {
    const q = this.s[this.i++];
    let out = "";
    for (;;) {
      if (this.i >= this.s.length) throw new LuaParseError("unterminated string");
      const c = this.s[this.i++];
      if (c === q) return out;
      if (c === "\\") {
        const e = this.s[this.i++];
        out += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e;
      } else out += c;
    }
  }

  private longString(): string {
    this.i += 2;
    const end = this.s.indexOf("]]", this.i);
    if (end < 0) throw new LuaParseError("unterminated long string");
    const out = this.s.slice(this.i, end);
    this.i = end + 2;
    return out;
  }

  private table(): LuaTable {
    this.i++; // {
    const t: LuaTable = { array: [], map: new Map() };
    for (;;) {
      this.ws();
      if (this.s[this.i] === "}") { this.i++; return t; }
      if (this.i >= this.s.length) throw new LuaParseError("unterminated table");
      // [key] = value  |  name = value  |  value (array item)
      let key: string | null = null;
      if (this.s[this.i] === "[") {
        this.i++;
        const k = this.value();
        this.ws();
        if (this.s[this.i] !== "]") throw new LuaParseError("expected ]");
        this.i++;
        this.ws();
        if (this.s[this.i] !== "=") throw new LuaParseError("expected =");
        this.i++;
        key = String(k === "__nil__" ? "" : k);
      } else {
        IDENT.lastIndex = this.i;
        const m = IDENT.exec(this.s);
        if (m) {
          const save = this.i;
          this.i += m[0].length;
          this.ws();
          if (this.s[this.i] === "=") { this.i++; key = m[0]; }
          else { this.i = save; }
        }
      }
      const v = this.value();
      if (v !== ("__nil__" as unknown as LuaValue)) {
        if (key === null) t.array.push(v);
        else t.map.set(key, v);
      }
      this.ws();
      if (this.s[this.i] === "," || this.s[this.i] === ";") this.i++;
    }
  }
}

function toPlain(v: LuaValue): unknown {
  if (typeof v !== "object" || v === null) return v;
  // `items = {}` is a kill that dropped nothing. An empty Lua table has no keys to tell an array from a map.
  if (v.array.length === 0 && v.map.size === 0) return [];
  // Lua 1-indexed arrays serialize as objects with numeric keys in map or array items.
  if (v.array.length > 0 && v.map.size === 0) return v.array.map(toPlain);
  const obj: Record<string, unknown> = {};
  for (const [k, val] of v.map) obj[k] = toPlain(val);
  // Numeric-keyed maps (e.g. ["1"] = {...} from ["..."] keys) become arrays when dense.
  const keys = [...v.map.keys()];
  if (v.array.length === 0 && keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
    const nums = keys.map(Number).sort((a, b) => a - b);
    if (nums[0] === 1 && nums.every((n, i) => n === i + 1)) {
      return nums.map((n) => toPlain(v.map.get(String(n)) as LuaValue));
    }
  }
  if (v.array.length > 0) obj["__array"] = v.array.map(toPlain);
  return obj;
}

export interface EverlootFile {
  version: string;
  installId: string;
  /** GetBuildInfo() version and build, written by addon 0.2.6+. */
  clientBuild?: string;
  records: Array<Record<string, unknown>>;
}

/** The whole EverlootDB table as plain values, for readers that need more than the records (the /ask bridge). */
export function parseEverlootTable(text: string): Record<string, unknown> {
  const plain = toPlain(new Parser(text).parse());
  return Array.isArray(plain) ? {} : (plain as Record<string, unknown>);
}

/**
 * The PolestarRecorderDB table of a Polestar_Recorder.lua file (written by the Polestar Recorder addon) as plain
 * values: the same Lua subset, read the same way, never executed. Converting it is `lib/polestar-recorder.ts`.
 */
export function parsePolestarTable(text: string): Record<string, unknown> {
  // The game can write the file back empty after a restart: that is an empty file, not a broken one.
  if (/PolestarRecorderDB\s*=\s*nil\b/.test(text)) return {};
  const plain = toPlain(new Parser(text, "PolestarRecorderDB", "a Polestar Recorder file").parse());
  return Array.isArray(plain) ? {} : (plain as Record<string, unknown>);
}

/** Parse Everloot.lua text into an intake-ready payload. Throws LuaParseError, for a file holding anything besides
 *  the EverlootDB assignment too: its only saved variable (addon/Everloot.toc), so a game-written file holds no more. */
export function parseEverlootLua(text: string): EverlootFile {
  const root = new Parser(text).parseWhole();
  const get = (k: string): LuaValue | undefined => root.map.get(k);
  const version = get("version");
  const installId = get("installId");
  if (typeof version !== "string" || typeof installId !== "string") {
    throw new LuaParseError("EverlootDB needs version + installId strings");
  }
  const recordsNode = get("records");
  if (typeof recordsNode !== "object" || recordsNode === null || !("map" in recordsNode)) {
    throw new LuaParseError("EverlootDB.records is not a table");
  }
  const records: Array<Record<string, unknown>> = [];
  for (const [kind, rows] of (recordsNode as LuaTable).map) {
    const list = toPlain(rows);
    if (!Array.isArray(list)) throw new LuaParseError(`records.${kind} is not a list`);
    for (const row of list) {
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        throw new LuaParseError(`records.${kind} holds a non-row`);
      }
      // kind lives in the table key, not the row — the intake contract needs it per record. The table's kind is set
      // last, so a field of the row cannot make a sighting read as another kind. A row's own installId stays, so
      // intake still sees, and refuses, an upload that mixes installs.
      records.push({ installId, ...(row as Record<string, unknown>), kind });
    }
  }
  const clientBuild = get("clientBuild");
  return { version, installId, ...(typeof clientBuild === "string" ? { clientBuild } : {}), records };
}
