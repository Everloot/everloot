/**
 * Inline wiki templates that the generic converter would drop mid-sentence ("purchased for at
 * standing"), rendered to the words a reader would see. Everything not listed here is left for the
 * converter. Each handled template has a fixture test; the list grows only with one.
 *
 * One left-to-right pass: `{{` opens a buffer, `}}` closes the innermost one and renders it, so
 * nesting resolves innermost-first and the cost is linear in the page size. Past MAX_DEPTH the braces
 * are kept as text, so a pathological nest cannot make each close re-copy the whole page.
 */

/** Template names (lower-case) this module renders or removes, for the coverage page. */
export const REPAIRED_TEMPLATES = [
  "g", "s", "c", "cost", "money",
  "npc", "item", "quest", "spell", "zone", "ability", "race",
  "rep", "faction standing", "patch",
  "horde icon", "horde icon small", "alliance icon", "alliance icon small", "neutral icon", "neutral icon small",
  "alliance", "horde", "neutral",
  "wp", "wplink", "au", "alternate universe", "loot", "coppercost", "cv-ah",
  "co", "coords", "reputation", "quality", "costitem",
  "api", "raceicon", "classicon", "socket icon", "mob", "fu", "expac", "achievement", "title", "school", "gossip", "keypress",
  "starcraft", "sc", "overwatch", "diablo", "dash", "-", "–", "queststart", "queststartfinish",
  "wow-inline", "bc-inline", "wotlk-inline", "legion-inline", "wod-inline", "bfa-inline", "sl-inline", "df-inline",
  "ss", "for", "stub", "removed",
];

const QUALIFIERS = new Set([
  "alliance", "horde", "neutral", "poor", "common", "uncommon", "rare", "epic", "legendary", "artifact", "heirloom",
]);

/** Stands in for a removed template until the line clean-up below; never appears in wikitext. */
const REMOVED = "\u0000";

/** Deepest template nest rendered; real pages stay in single digits. */
const MAX_DEPTH = 32;

/** Splits template arguments on top-level `|`, ignoring pipes inside nested `[[ ]]` (nested `{{ }}` are already rendered). */
function splitArgs(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    const two = inner.slice(i, i + 2);
    if (two === "[[") { depth++; cur += two; i++; continue; }
    if (two === "]]") { depth--; cur += two; i++; continue; }
    if (inner[i] === "|" && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += inner[i];
  }
  out.push(cur);
  return out;
}

function money(parts: string[]): string {
  const [g, s, c] = [0, 1, 2].map((i) => (parts[i] ?? "").trim());
  const out: string[] = [];
  if (g && g !== "0") out.push(`${g}g`);
  if (s && s !== "0") out.push(`${s}s`);
  if (c && c !== "0") out.push(`${c}c`);
  return out.length > 0 ? out.join(" ") : (g || s || c ? "0c" : "");
}

/**
 * {{cost}}'s other currencies in the template's own order: the named argument(s), then the article the
 * icon links to. Read from Template:Cost in the 2023-11-13 dump; `eots` wins over its older name `es`.
 */
const CURRENCIES: Array<[string[], string]> = [
  [["ach"], "Achievement point"], [["cs"], "Champion's Seal"], [["djt"], "Dalaran Jewelcrafter's Token"], [["ea"], "Epicurean's Award"],
  [["tbc"], "Tol Barad Commendation"], [["ijt"], "Illustrious Jewelcrafter's Token"], [["mwt"], "Mark of the World Tree"], [["dpt"], "Darkmoon Prize Ticket"],
  [["it"], "Ironpaw Token"], [["lcgf"], "Lesser Charm of Good Fortune"], [["ecgf"], "Elder Charm of Good Fortune"], [["mrf"], "Mogu Rune of Fate"],
  [["ws"], "Warforged Seal"], [["tc"], "Timeless Coin"], [["bc"], "Bloody Coin"], [["twb"], "Timewarped Badge"],
  [["ss"], "Spirit Shard"], [["conq"], "Conquest"], [["hon"], "Honor"], [["diak"], "Dragon Isles Alchemy Knowledge"],
  [["dibk"], "Dragon Isles Blacksmithing Knowledge"], [["dienck"], "Dragon Isles Enchanting Knowledge"], [["diengk"], "Dragon Isles Engineering Knowledge"], [["dihk"], "Dragon Isles Herbalism Knowledge"],
  [["diik"], "Dragon Isles Inscription Knowledge"], [["dijk"], "Dragon Isles Jewelcrafting Knowledge"], [["dilk"], "Dragon Isles Leatherworking Knowledge"], [["dimk"], "Dragon Isles Mining Knowledge"],
  [["disk"], "Dragon Isles Skinning Knowledge"], [["ditk"], "Dragon Isles Tailoring Knowledge"], [["bt"], "Bloody Tokens"], [["dge"], "Dragon Glyph Embers"],
  [["dis"], "Dragon Isles Supplies"], [["efa"], "Effigy Adornments"], [["eo"], "Elemental Overflow"], [["sts"], "Storm Sigil"],
  [["pae"], "Purified Arcane Energy"], [["fs"], "Flightstones"], [["pf"], "Paracausal Flakes"], [["roab"], "Riders of Azeroth Badge"],
  [["arc"], "Argent Commendation"], [["cr"], "Cataloged Research"], [["cf"], "Cosmic Flux"], [["cfo"], "Cyphers of the First Ones"],
  [["go"], "Grateful Offering"], [["ir"], "Infused Ruby"], [["ph"], "Phantasma"], [["ra"], "Reservoir Anima"],
  [["rs"], "Redeemed Soul"], [["sf"], "Sinstone Fragments"], [["sa"], "Soul Ash"], [["sc"], "Soul Cinders"],
  [["st"], "Stygia"], [["7sm"], "7th Legion Service Medal"], [["cv"], "Coalescing Visions"], [["cm"], "Corrupted Mementos"],
  [["eon"], "Echoes of Ny'alotha"], [["hsm"], "Honorbound Service Medal"], [["pm"], "Prismatic Manapearl"], [["sd"], "Seafarer's Dubloon"],
  [["tr"], "Titan Residuum"], [["wr"], "War Resources"], [["am"], "Ancient Mana"], [["bg"], "Brawler's Gold"],
  [["ca"], "Coins of Air"], [["cc"], "Curious Coin"], [["moh"], "Mark of Honor"], [["ns"], "Nethershard"],
  [["or"], "Order Resources"], [["sbf"], "Seal of Broken Fate"], [["se"], "Sightless Eye"], [["ta"], "Timeworn Artifact"],
  [["tst"], "Trial of Style Token"], [["lws"], "Legionfall War Supplies"], [["va"], "Veiled Argunite"], [["eob"], "Echoes of Battle"],
  [["eod"], "Echoes of Domination"], [["we"], "Wakening Essence"], [["ac"], "Apexis Crystal"], [["af"], "Artifact Fragment"],
  [["gr"], "Garrison Resources"], [["oil"], "Oil (currency)"], [["stf"], "Seal of Tempered Fate"], [["sif"], "Seal of Inevitable Fate"],
  [["dic"], "Dingy Iron Coins"], [["v"], "Valor"], [["dca"], "Epicurean's Award"], [["h"], "Honor Points"],
  [["h-h"], "Honor Points"], [["a-h"], "Honor Points"], [["wsg"], "Warsong Gulch Mark of Honor"], [["ab"], "Arathi Basin Mark of Honor"],
  [["av"], "Alterac Valley Mark of Honor"], [["eots", "es"], "Eye of the Storm Mark of Honor"], [["sota"], "Strand of the Ancients Mark of Honor"], [["ic"], "Isle of Conquest Mark of Honor"],
  [["w"], "Wintergrasp Mark of Honor"], [["a"], "Arena point"], [["sks"], "Stone Keeper's Shard"], [["vc"], "Venture Coin"],
  [["boj"], "Badge of Justice"], [["eoh"], "Emblem of Heroism"], [["eov"], "Emblem of Valor"], [["eoc"], "Emblem of Conquest"],
  [["eot"], "Emblem of Triumph"], [["eof"], "Emblem of Frost"], [["vp"], "Valor Points"], [["jp"], "Justice Points"],
  [["hp"], "Honor Points"], [["h-hp"], "Honor Points"], [["a-hp"], "Honor Points"], [["cp"], "Conquest Points"],
  [["h-cp"], "Conquest Points"], [["a-cp"], "Conquest Points"],
];

/** {{cost}}: gold, silver and copper (named g/s/c win over 1/2/3), then each other currency as "amount Name", then a custom name=/cost= pair. */
function cost(positional: string[], named: Record<string, string>): string {
  const out = [money([named.g ?? positional[0], named.s ?? positional[1], named.c ?? positional[2]])];
  for (const [codes, currency] of CURRENCIES) {
    const amount = codes.map((k) => named[k]).find((v) => v !== undefined);
    if (amount) out.push(`${amount} ${currency}`);
  }
  if (named.name) out.push(`${named.cost ?? ""} ${named.name}`.trim());
  return out.filter(Boolean).join(" ");
}

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The rendering for one template (its inner text, nested templates already rendered), or null when it is not ours. */
function render(inner: string): string | null {
  const args = splitArgs(inner);
  const name = args[0].trim().toLowerCase();
  const positional = args.slice(1).filter((a) => !a.includes("=")).map((a) => a.trim());
  const named = Object.fromEntries(
    args.slice(1).filter((a) => a.includes("=")).map((a) => [a.slice(0, a.indexOf("=")).trim().toLowerCase(), a.slice(a.indexOf("=") + 1).trim()]),
  ) as Record<string, string>;

  if (name === "g" || name === "s" || name === "c") return name;
  if (name === "cost") return cost(positional, named);
  if (name === "money") return money(positional);
  if (name === "rep" || name === "faction standing") return capitalise(positional[0] ?? "");
  // {{Race|Gilgoblin}} shows the race's name, {{Race|Orc|orcs}} the label, {{Race|Skrog|notext}} only its icon.
  if (name === "race") return positional[1] === "notext" ? REMOVED : positional[1] || positional[0] || "";
  if (/^patch \d/.test(name)) return `${capitalise(args[0].trim())}${named.note ? `: ${named.note}` : ""}`;
  if (["npc", "item", "quest", "spell", "zone", "ability"].includes(name)) {
    if (positional.length === 0) return "";
    if (positional.length >= 2 && (positional[0] === "" || QUALIFIERS.has(positional[0].toLowerCase()))) {
      return positional[positional.length - 1] || positional[1];
    }
    return positional[positional.length - 1];
  }
  // {{wp|Article|label}} links Wikipedia, {{au|Name|label}} the "Name (alternate universe)" page; both show the label or the name.
  if (["wp", "wplink", "au", "alternate universe"].includes(name)) return positional[1] || positional[0] || "";
  // {{loot|quality|Item|label}}: the label, else the item name.
  if (name === "loot") return positional[2] || positional[1] || "";
  // {{coppercost|86000}}: one copper amount, shown as gold, silver and copper.
  if (name === "coppercost") {
    const copper = (positional[0] ?? "").replace(/,/g, "");
    if (!/^\d+$/.test(copper)) return null;
    const n = Number(copper);
    return money([String(Math.floor(n / 10000)), String(Math.floor((n % 10000) / 100)), String(n % 100)]);
  }
  // {{cv-AH|Alliance text|Horde text}}: the wiki shows one side by the reader's faction, "A or H" without it.
  if (name === "cv-ah") return [positional[0], positional[1]].filter(Boolean).join(" or ");
  // {{co|47|78|Arathi Highlands}} (a redirect to {{coords}}) shows the map coordinates as "[47, 78]".
  if (name === "co" || name === "coords") return `[${positional[0] || "0"}, ${positional[1] || "0"}]`;
  // {{reputation|Revered}}, {{quality|epic|Item|label}}: the label, else the link, else the standing or quality as written.
  if (name === "reputation" || name === "quality") return positional[2] || positional[1] || positional[0] || "";
  // {{costitem|8|Bolt of Embersilk Cloth}} is the count and the item's icon; the item name stands in for the icon.
  if (name === "costitem") {
    const count = positional[0] || "1";
    const shown = /^\d+$/.test(count) ? Number(count).toLocaleString("en-US") : count;
    return positional[1] ? `${shown}${named.numsep ?? " "}${positional[1]}` : shown;
  }
  // {{api|GetSubZoneText}}, {{api|CreateFrame()|label}}, {{api|t=wh|OnEvent}}: the label, else the name, with any "(args)" kept for functions.
  if (name === "api") {
    const target = positional[0] ?? "";
    const type = named.t ?? "a";
    const paren = target.indexOf("(");
    if (positional[1]) return positional[1] + (paren >= 0 && ["a", "w", "wm"].includes(type) ? target.slice(paren) : "");
    return target;
  }
  // {{mob|Name}}, {{mob|Link||Label}}: the label, else the name (the A/H standing marks are icons).
  if (name === "mob") return positional[2] || positional[0] || "";
  // {{fu|Name|label}} (Film universe), like {{au}}, and {{expac|Dragonflight}}: the label, else the name as written.
  if (name === "fu" || name === "film universe") return positional[1] || positional[0] || "";
  if (name === "expac") return positional[0] ?? "";
  // {{achievement|Name|label}}: the label, else the name; the coin icon is dropped.
  if (name === "achievement") return positional[1] || positional[0] || "";
  // {{title|Vendor}} shows <Vendor> in small text.
  if (name === "title") return positional[0] ? `<${positional[0]}>` : "";
  // {{school|Fire|label}}, {{gossip|text}}, {{keypress|Shift|1}}: the text the template wraps.
  if (name === "school") return positional[1] || positional[0] || "";
  if (name === "gossip") return positional[0] ?? "";
  if (name === "keypress") return positional.filter(Boolean).join(named.chain ?? "+");
  // {{StarCraft|Page|label}} and friends link another wiki: the label, else the page.
  if (["starcraft", "sc", "overwatch", "diablo"].includes(name)) return positional[1] || positional[0] || "";
  if (name === "dash") return "–";
  // {{-}} redirects to {{–}}, which the wiki renders as an em dash: "''The Wolvar'' {{-}} after completing".
  if (name === "-" || name === "–") return "—";
  // Icon-only templates: a race, class or socket icon, a quest marker or an expansion logo.
  if (["raceicon", "classicon", "socket icon", "queststart", "queststartfinish"].includes(name) || /^(wow|bc|wotlk|legion|wod|bfa|sl|df)-inline$/.test(name)) return REMOVED;
  // {{Alliance}}, {{Horde}}, {{Neutral}} are the small faction icon alone.
  if (/^(horde|alliance|neutral)( icon( small)?)?$/.test(name)) return REMOVED;
  if (name === "ss" || name === "for" || name === "removed" || name.startsWith("stub")) return REMOVED;
  return null;
}

/** Tags whose content the wiki shows as written: comment syntax and other tags inside them are plain text. */
const LITERAL_TAGS = new Set(["nowiki", "pre", "poem", "syntaxhighlight", "source"]);

/** The closing tag of each tag the pass reads, matched exactly at a position: `</references>` is not `</ref>`. */
const CLOSERS = new Map([...LITERAL_TAGS, "code", "ref"].map((name) => [name, new RegExp(`</${name}\\s*>`, "y")]));

/** Holds a verbatim span's place while the spaces around it are collapsed. */
const HELD = (n: number) => `\u0002${n}\u0003`;

/** Lower-cases A to Z only, so every offset in the result is the same offset in the original ("İ" would grow). */
const asciiLower = (s: string) => s.replace(/[A-Z]+/g, (m) => m.toLowerCase());

/**
 * Reads the opening tag at `start` up to its `>`, however long. A quoted attribute value may hold a ">"
 * (`<ref name="a>b" />`), but a quote counts only when it closes before the next "<" or line break: the
 * wiki has many `<ref name="Source>…</ref>` with the closing quote missing, and those end at the first ">".
 * The quote-aware read stops at the next "<", so the reads of all tags together cover the page about once;
 * when it meets one, the tag ends at the first ">" after it (`nextGt`), as the wiki reads a malformed
 * `<ref name="Bane" /<ref name="Yorgen" />`.
 */
function readTag(text: string, start: number, nameLength: number, nextLt: number, nextGt: number): { end: number; selfClosing: boolean } | null {
  const stop = nextLt === -1 ? text.length : nextLt;
  let lineEnd = -1;
  let afterEquals = false;
  for (let i = start + 1 + nameLength; i < stop; i++) {
    const ch = text[i];
    if (ch === ">") return { end: i + 1, selfClosing: text[i - 1] === "/" };
    if (ch === "=") { afterEquals = true; continue; }
    if (afterEquals && (ch === '"' || ch === "'")) {
      if (lineEnd < i) { lineEnd = i; while (lineEnd < stop && text[lineEnd] !== "\n") lineEnd++; }
      // After a quote that does not close on its line there is no other such quote on it, so these
      // searches never read the same stretch twice.
      const close = text.slice(i + 1, lineEnd).indexOf(ch);
      if (close !== -1) i += close + 1;
    }
    if (ch !== " " && ch !== "\t" && ch !== "\n") afterEquals = false;
  }
  if (nextLt === -1 || nextGt === -1) return null;
  return { end: nextGt + 1, selfClosing: text[nextGt - 1] === "/" };
}

/** The first ">" at or after a position; asked in increasing order, so the page is read once. */
function gtFinder(text: string) {
  let at = -2;
  return (from: number): number => {
    if (at === -1 || (at !== -2 && at >= from)) return at;
    at = text.indexOf(">", from);
    return at;
  };
}

/**
 * The pass before templates render. One forward scan reads the page the way the wiki does, each part in
 * its own context:
 *
 * - A comment is opaque: a tag inside it is not a tag. It is kept as written.
 * - `<nowiki>`, `<pre>`, `<poem>`, `<syntaxhighlight>` and `<source>` are literal: comment syntax and tags
 *   inside them are text, and only their own closing tag ends them. They are kept as written.
 * - `<code>` is unwrapped (with any `<nowiki>` inside it), and its text kept as written: the converter drops
 *   everything inside `<code>`, which lost lore lines like `<code>{{api|C_Map}}</code>`, and the spaces in
 *   code are content. Inside it, comments and literal tags are read as above, so a `</code>` inside them
 *   does not close it.
 * - `<ref>` footnotes go. The converter drops them too but leaves a space for each, so a name with three
 *   sources (`'''Helhounds'''<ref>…</ref><ref>…</ref><ref>…</ref> are`) read "Helhounds  are". A ref ends at
 *   its own `</ref>`, not at one inside a comment; a ref that never closes is left for the converter.
 * - A comment, literal tag or `<code>` that never closes runs to the end of the page, kept as written.
 * - Everywhere else, runs of spaces collapse. A browser shows a run as one space, so the wiki never shows
 *   the doubled spaces its source often has (`after  completing`, `'''Garn Cloudsong ''' is`,
 *   `In ''[[World of Warcraft: Classic| Classic]]''`); kept, they would read as a dropped template. A
 *   doubled space left in the output therefore still means a template was lost. A line that starts with a
 *   space is preformatted on the wiki and shows its spaces, so it is left as written.
 *
 * Every search moves forward and each part of the page is read about once, so the pass is linear.
 */
function prepare(wikitext: string): string {
  const lower = asciiLower(wikitext);
  const length = wikitext.length;
  const gt = gtFinder(wikitext);
  const held: string[] = [];
  const hold = (s: string) => HELD(held.push(s) - 1);
  // A marker character already in the text is held itself, so it cannot be read as a held span.
  const plain = (s: string) => s.replace(/[\u0002\u0003]/g, hold);

  /** Where the comment opening at `at` ends. */
  const commentEnd = (at: number) => { const close = lower.indexOf("-->", at + 4); return close === -1 ? length : close + 3; };

  /** The end of `</name>` exactly at `at`, or -1. */
  const closesAt = (name: string, at: number): number => {
    const re = CLOSERS.get(name)!;
    re.lastIndex = at;
    return re.test(lower) ? re.lastIndex : -1;
  };

  /** The opening tag at `lt` when it is one this pass reads, by its exact name. */
  const openTag = (lt: number) => {
    const name = /^[a-z]+/.exec(lower.slice(lt + 1, lt + 17))?.[0] ?? "";
    if (name !== "ref" && name !== "code" && !LITERAL_TAGS.has(name)) return null;
    const boundary = lower[lt + 1 + name.length];
    if (!(boundary === undefined || boundary === ">" || boundary === "/" || /\s/.test(boundary))) return null;
    const tag = readTag(wikitext, lt, name.length, lower.indexOf("<", lt + 1), gt(lt));
    return tag && { name, ...tag };
  };

  /** Where a literal tag's own closing tag starts and ends; nothing inside it is read. */
  const literalClose = (name: string, from: number): { start: number; end: number } | null => {
    for (let at = lower.indexOf(`</${name}`, from); at !== -1; at = lower.indexOf(`</${name}`, at + 1)) {
      const end = closesAt(name, at);
      if (end !== -1) return { start: at, end };
    }
    return null;
  };

  /** Where `</code>` closes a code body, skipping comments and literal tags; null when it never does. */
  const codeClose = (from: number): { start: number; end: number } | null => {
    for (let at = lower.indexOf("<", from); at !== -1; at = lower.indexOf("<", at)) {
      if (lower.startsWith("<!--", at)) { at = commentEnd(at); continue; }
      const end = closesAt("code", at);
      if (end !== -1) return { start: at, end };
      const tag = openTag(at);
      if (tag && LITERAL_TAGS.has(tag.name) && !tag.selfClosing) {
        const close = literalClose(tag.name, tag.end);
        if (!close) return null;
        at = close.end;
        continue;
      }
      at = tag ? tag.end : at + 1;
    }
    return null;
  };

  // Once a ref finds no `</ref>` from some point on, no later ref can find one either.
  let refNeverCloses = Infinity;
  /** Where `</ref>` closes a ref body, skipping comments; null when it never does. */
  const refClose = (from: number): { start: number; end: number } | null => {
    if (from >= refNeverCloses) return null;
    let comment = lower.indexOf("<!--", from);
    let closer = lower.indexOf("</ref", from);
    while (closer !== -1) {
      if (comment !== -1 && comment < closer) {
        const after = commentEnd(comment);
        if (closer < after) closer = lower.indexOf("</ref", after);
        comment = lower.indexOf("<!--", after);
        continue;
      }
      const end = closesAt("ref", closer);
      if (end !== -1) return { start: closer, end };
      closer = lower.indexOf("</ref", closer + 1);
    }
    refNeverCloses = from;
    return null;
  };

  let out = "";
  let i = 0;
  while (i < length) {
    const lt = lower.indexOf("<", i);
    if (lt === -1) { out += plain(wikitext.slice(i)); break; }
    out += plain(wikitext.slice(i, lt));
    i = lt;
    if (lower.startsWith("<!--", lt)) {
      i = commentEnd(lt);
      out += hold(wikitext.slice(lt, i));
      continue;
    }
    const tag = openTag(lt);
    if (!tag) { out += "<"; i = lt + 1; continue; }
    if (tag.selfClosing) {
      if (LITERAL_TAGS.has(tag.name)) out += hold(wikitext.slice(lt, tag.end));
      i = tag.end;
      continue;
    }
    const close = tag.name === "ref" ? refClose(tag.end) : tag.name === "code" ? codeClose(tag.end) : literalClose(tag.name, tag.end);
    if (!close) {
      if (tag.name === "ref") { out += "<"; i = lt + 1; continue; }
      out += hold(wikitext.slice(lt)); // never closes: the rest of the page stays as written
      break;
    }
    if (tag.name === "code") out += hold(wikitext.slice(tag.end, close.start).replace(/<\/?nowiki\s*>/gi, ""));
    else if (tag.name !== "ref") out += hold(wikitext.slice(lt, close.end));
    i = close.end;
  }
  return out
    .split("\n")
    .map((line) => (line.startsWith(" ") ? line : line
      .replace(/( '{0,5}\[\[[^[\]|\n]*\|) +/g, "$1") // a link label that starts with a space, after a space
      .replace(/(?<! ) +\]\](?= )/g, "]]") // a link label that ends with a space, before a space
      .replace(/(\S) +('{2,5}) +/g, "$1$2 ") // bold or italic quotes with a space on each side
      .replace(/(\S) {2,}(?=\S)/g, "$1 ")))
    .join("\n")
    .replace(/\u0002(\d+)\u0003/g, (_, n: string) => held[Number(n)]);
}

/** Renders the handled templates to text in one pass, leaving unknown templates and all line structure untouched. */
export function repairTemplates(rawWikitext: string): string {
  const wikitext = prepare(rawWikitext);
  const stack: string[] = [];
  let cur = "";
  let literal = 0; // opens past MAX_DEPTH, kept as text along with their closes
  for (let i = 0; i < wikitext.length; i++) {
    const two = wikitext.slice(i, i + 2);
    if (two === "{{" && stack.length >= MAX_DEPTH) { literal++; cur += two; i++; continue; }
    if (two === "}}" && literal > 0) { literal--; cur += two; i++; continue; }
    if (two === "{{") { stack.push(cur); cur = ""; i++; continue; }
    if (two === "}}" && stack.length > 0) {
      const inner = cur;
      cur = stack.pop()!;
      const rendered = render(inner);
      cur += rendered === null ? `{{${inner}}}` : rendered;
      i++;
      continue;
    }
    cur += wikitext[i];
  }
  // Unclosed `{{`: put the raw opening back and keep whatever was rendered inside it.
  while (stack.length > 0) cur = `${stack.pop()!}{{${cur}`;
  // A removed template leaves its spacing behind: drop lines that held only removed templates, and
  // collapse the spaces around removed templates inside a line. Blank lines and indentation stay.
  return cur
    .split("\n")
    .filter((line) => !(line.includes(REMOVED) && line.replace(new RegExp(REMOVED, "g"), "").trim() === ""))
    .map((line) => (line.includes(REMOVED) ? line.replace(new RegExp(`^(${REMOVED} *)+`), "").replace(new RegExp(`(?<! ) *(?:${REMOVED} *)+`, "g"), " ").replace(/(?<! ) +$/, "") : line))
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

// " for at " is what "for {{cost}} at {{rep}}" leaves, but "for at least" (and most, all, once) is plain English:
// in the 2026-10-24 release it alone marked 91 pages damaged that were not.
const DAMAGE_PATTERNS = [/ for at (?!(?:least|most|all|once)\b)/, / at standing/, / at {2}/, / {2}standing/, /\w {2}\w/];

/** How many breakage patterns the converted text shows; 0 means clean. */
export function countDamage(text: string): number {
  return DAMAGE_PATTERNS.filter((re) => re.test(text)).length;
}
