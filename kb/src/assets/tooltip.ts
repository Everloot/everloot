/**
 * Turns a spell description as the client stores it ("Increases damage by $s1% for $d.") into plain text.
 * Only the variables whose value is in the tables we read are resolved. Anything else becomes the
 * placeholder PLACEHOLDER and is listed in `unresolved`: a value is never guessed.
 */

export const PLACEHOLDER = "[?]";

export interface EffectFacts {
  index: number;
  basePoints: number;
  dieSides: number;
  periodMs: number;
  chainTargets: number;
  radiusYards: number | null;
  /** SpellEffect.Variance: the value spreads over base × (1 ± variance / 2). 0 or absent: no spread. */
  variance?: number;
}

export interface SpellFacts {
  effects: EffectFacts[];
  durationMs: number | null;
  procChance?: number | null;
  procCharges?: number | null;
  name?: string | null;
  /** The spell's own description text, as stored, for `$@spelldesc<id>` in another spell's text. */
  description?: string | null;
}

export type SpellLookup = (spellId: number) => SpellFacts | undefined;

export interface Resolved {
  text: string;
  /** The tokens that were left as a placeholder, as written in the source text. */
  unresolved: string[];
}

/** Print a number the way the game does: no trailing zeros, at most two decimals. */
function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function duration(ms: number): string {
  const s = ms / 1000;
  if (s >= 3600) return `${fmt(s / 3600)} ${s / 3600 === 1 ? "hour" : "hours"}`;
  if (s >= 60) return `${fmt(s / 60)} min`;
  return `${fmt(s)} sec`;
}

/**
 * Low and high value of an effect, and the one value an expression uses. The long-standing rule: with dice, the
 * roll is base+1 up to base+sides. Newer tables keep the base and a Variance instead, which the game prints as
 * base × (1 ± variance / 2), rounded (Minor Mana Potion: base 160, variance 0.25, "restores 140 to 180 mana").
 */
function range(e: EffectFacts): { min: number; max: number; one: number } {
  if (e.variance && e.variance > 0) return { min: Math.round(e.basePoints * (1 - e.variance / 2)), max: Math.round(e.basePoints * (1 + e.variance / 2)), one: e.basePoints };
  if (e.dieSides > 1) return { min: e.basePoints + 1, max: e.basePoints + e.dieSides, one: e.basePoints + 1 };
  const v = e.basePoints + (e.dieSides === 1 ? 1 : 0);
  return { min: v, max: v, one: v };
}

class Unresolvable extends Error {}

/**
 * How a variable is wanted. "text": as printed in the sentence (always positive, a range as "a to b").
 * "number": a positive number, for `$/1000;s1`. "signed": the stored sign kept, for `${...}` expressions,
 * where the text itself divides by a negative to turn a reduction into a positive.
 */
type Mode = "text" | "number" | "signed";

/**
 * One `$` variable's value (a number, or a ready string for `$d` and ranges), or throws Unresolvable.
 * An effect value of exactly 0 is left open: the tables hold 0 where the real number comes from
 * somewhere else (a triggered spell, a per-rank spell), and a printed "0%" would be a made-up fact.
 */
function variable(letter: string, digit: number, facts: SpellFacts, mode: Mode): number | string {
  const eff = () => {
    const e = facts.effects.find((x) => x.index === digit - 1);
    if (!e) throw new Unresolvable();
    return e;
  };
  const shape = (v: number) => (mode === "signed" ? v : Math.abs(v));
  const real = (v: number) => {
    if (v === 0) throw new Unresolvable();
    return shape(v);
  };
  const plain = mode !== "text";
  switch (letter) {
    case "s": case "S": {
      const r = range(eff());
      return r.min === r.max || plain ? real(r.one) : `${fmt(Math.abs(r.min))} to ${fmt(Math.abs(r.max))}`;
    }
    case "m": return real(range(eff()).min);
    case "M": return real(range(eff()).max);
    case "t": case "T": {
      const p = eff().periodMs;
      if (!p) throw new Unresolvable();
      return p / 1000;
    }
    case "o": case "O": {
      const e = eff();
      if (!e.periodMs || !facts.durationMs) throw new Unresolvable();
      return real(range(e).one * (facts.durationMs / e.periodMs));
    }
    case "a": case "A": {
      const r = eff().radiusYards;
      if (!r) throw new Unresolvable();
      return r;
    }
    case "x": case "X": {
      const c = eff().chainTargets;
      if (!c) throw new Unresolvable();
      return c;
    }
    case "d": case "D":
      if (!facts.durationMs || facts.durationMs < 0) throw new Unresolvable();
      return plain ? facts.durationMs / 1000 : duration(facts.durationMs);
    case "h": case "H":
      if (!facts.procChance) throw new Unresolvable();
      return facts.procChance;
    case "n": case "N":
      if (!facts.procCharges) throw new Unresolvable();
      return facts.procCharges;
    default:
      throw new Unresolvable();
  }
}

/** Arithmetic over numbers: + - * / and parentheses. No eval. */
function evaluate(expr: string, value: (token: string) => number): number {
  const toks = expr.match(/\$[0-9]*[a-zA-Z][0-9]?|\d+(?:\.\d+)?|[()+\-*/]/g) ?? [];
  if (toks.join("") !== expr.replace(/\s+/g, "")) throw new Unresolvable();
  let i = 0;
  const atom = (): number => {
    const t = toks[i++];
    if (t === undefined) throw new Unresolvable();
    if (t === "(") { const v = sum(); if (toks[i++] !== ")") throw new Unresolvable(); return v; }
    if (t === "-") return -atom();
    if (t.startsWith("$")) return value(t);
    const n = Number(t);
    if (Number.isNaN(n)) throw new Unresolvable();
    return n;
  };
  const product = (): number => {
    let v = atom();
    while (toks[i] === "*" || toks[i] === "/") {
      const op = toks[i++];
      const r = atom();
      if (op === "/" && r === 0) throw new Unresolvable();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (toks[i] === "+" || toks[i] === "-") v = toks[i++] === "+" ? v + product() : v - product();
    return v;
  };
  const out = sum();
  if (i !== toks.length) throw new Unresolvable();
  return out;
}

/** Index of the `]` that closes the `[` at `open`, or -1. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]" && --depth === 0) return i;
  }
  return -1;
}

/** Strip colour codes, texture and link escapes the client uses in spell text. */
function stripEscapes(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\|n/g, "\n")
    .replace(/\|T[^|]*\|t/gi, "")
    .replace(/\|H[^|]*\|h\[?([^|\]]*)\]?\|h/gi, "$1")
    .replace(/\|cn[A-Za-z0-9_]+:/gi, "")
    .replace(/\|c[0-9a-f]{8}/gi, "")
    .replace(/\|r/gi, "");
}

/** How many `$@spelldesc` hops one description follows; a loop between two spells stops here. */
const MAX_DESCRIPTION_DEPTH = 3;

export function resolveTooltip(source: string, self: SpellFacts, others: SpellLookup = () => undefined, depth = 0): Resolved {
  const unresolved: string[] = [];
  const text = stripEscapes(source);
  let out = "";
  let i = 0;
  const miss = (raw: string) => { unresolved.push(raw); out += PLACEHOLDER; };

  /** Value of a `$[spellid]letter[digit]` token, as written in `raw`. */
  const tokenValue = (raw: string, mode: Mode): number | string => {
    const m = /^\$(\d+)?([a-zA-Z])(\d)?$/.exec(raw);
    if (!m) throw new Unresolvable();
    const facts = m[1] ? others(Number(m[1])) : self;
    if (!facts) throw new Unresolvable();
    return variable(m[2], m[3] ? Number(m[3]) : 1, facts, mode);
  };

  while (i < text.length) {
    if (text[i] !== "$") { out += text[i++]; continue; }
    const rest = text.slice(i);
    let m: RegExpExecArray | null;

    if ((m = /^\$\{([^}]*)\}(?:\.(\d))?/.exec(rest))) {
      try {
        const v = evaluate(m[1], (t) => {
          const x = tokenValue(t, "signed");
          if (typeof x !== "number") throw new Unresolvable();
          return x;
        });
        out += m[2] !== undefined ? v.toFixed(Number(m[2])) : fmt(v);
      } catch { miss(m[0]); }
      i += m[0].length;
    } else if ((m = /^\$([/*])(\d+(?:\.\d+)?);(\$?\d*[a-zA-Z]\d?)/.exec(rest)) || (m = /^\$([/*])(\d+(?:\.\d+)?);([a-zA-Z]\d?)/.exec(rest))) {
      const raw = m[0];
      try {
        const x = tokenValue(m[3].startsWith("$") ? m[3] : `$${m[3]}`, "number");
        if (typeof x !== "number") throw new Unresolvable();
        const k = Number(m[2]);
        if (m[1] === "/" && k === 0) throw new Unresolvable();
        out += fmt(m[1] === "/" ? x / k : x * k);
      } catch { miss(raw); }
      i += raw.length;
    } else if ((m = /^\$[lL]([^:;]*):([^;]*);/.exec(rest))) {
      // Plural by the number just before it.
      const prev = /(\d+(?:\.\d+)?)\D*$/.exec(out);
      if (prev && !out.endsWith(PLACEHOLDER)) out += Number(prev[1]) === 1 ? m[1] : m[2];
      else miss(m[0]);
      i += m[0].length;
    } else if ((m = /^\$g([^:;]*):([^;]*);/.exec(rest))) {
      // Not known here; both forms are shown rather than one chosen.
      out += `${m[1]}/${m[2]}`;
      i += m[0].length;
    } else if (rest.startsWith("$?")) {
      // A condition on the player's auras, spells or talents: the answer is not in the tables. The
      // whole `$?a123|a456[then][else]` (and any `?cond[..]` chained after it) is one placeholder.
      let end = i + 2;
      for (;;) {
        while (end < text.length && /[A-Za-z0-9!&|()]/.test(text[end])) end++;
        const c = text[end] === "[" ? closing(text, end) : -1;
        if (c < 0) break;
        end = c + 1;
        while (text[end] === "[") {
          const c2 = closing(text, end);
          if (c2 < 0) break;
          end = c2 + 1;
        }
        if (text[end] === "?") end++; else break;
      }
      miss(text.slice(i, end));
      i = end;
    } else if ((m = /^\$@spellname(\d+)/.exec(rest))) {
      const name = others(Number(m[1]))?.name;
      if (name) out += name; else miss(m[0]);
      i += m[0].length;
    } else if ((m = /^\$@spelldesc(\d+)/.exec(rest))) {
      // Another spell's description, resolved with that spell's own numbers. Anything it cannot resolve stays a placeholder.
      const other = others(Number(m[1]));
      const raw = other?.description?.trim();
      if (other && raw && depth < MAX_DESCRIPTION_DEPTH) {
        const inner = resolveTooltip(raw, other, others, depth + 1);
        out += inner.text;
        unresolved.push(...inner.unresolved);
      } else miss(m[0]);
      i += m[0].length;
    } else if ((m = /^\$@[a-z]+\d*/i.exec(rest)) || (m = /^\$<[^>]*>/.exec(rest)) || (m = /^\$[a-zA-Z]{2,}\d*/.exec(rest))) {
      // Another spell's text or icon, a named variable ($<mult>, $proccooldown, $pl): not in the tables.
      miss(m[0]);
      i += m[0].length;
    } else if ((m = /^\$(\d+)?([a-zA-Z])(\d)?/.exec(rest))) {
      try {
        const v = tokenValue(m[0], "text");
        out += typeof v === "number" ? fmt(v) : v;
      } catch { miss(m[0]); }
      i += m[0].length;
    } else {
      // "$" followed by something we do not know: keep going after it.
      miss("$");
      i += 1;
    }
  }
  return { text: out.replace(/[ \t]+\n/g, "\n").trim(), unresolved };
}
