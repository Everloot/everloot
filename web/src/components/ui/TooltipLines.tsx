import { CoinText } from "./Coins";
import { gameOrder, tipLine, type TipLine } from "@/lib/tip-line";

/** A set's name over its pieces (lib/item-tooltip.ts), "Name (0/8)"; on an armory gear card the pieces worn, "Name (6/8)". */
const SET_HEAD = / \(\d+\/\d+\)$/;
/** The mark withReported puts after a number fewer than 3 installs reported. */
const UNCONFIRMED_MARK = / (\(unconfirmed, seen by \d+ players?\))$/;

const TONE: Partial<Record<TipLine["kind"], string>> = {
  effect: "text-q-uncommon", yellow: "text-tip-yellow", stat: "text-fg", piece: "pl-2.5 text-muted", bonus: "text-muted",
};

/**
 * An item tooltip's lines laid out as the game draws them (lib/tip-line.ts): slot and kind, and damage and speed, in
 * two columns; Equip, Use and Chance on hit lines in green; the item level, a set and the flavour text in yellow; the
 * sell price in coins. The item level is drawn first, under the name, as the game does (`gameOrder`); the lines passed
 * in keep the order they are served in. Every line keeps its words, so no colour is the only signal, and the reading
 * order is the visual order. Stats and armour with their numbers in white; a set's pieces, indented, and its bonuses
 * in grey, with the game's blank line above the set's name and its first bonus; a number's "(unconfirmed, …)" mark muted
 * after it. `links` turns a line into a link to its page (the item page's box: the set and its pieces); the hover card
 * takes no pointer, so it passes none. Any other line is drawn as it is.
 */
export default function TooltipLines({ lines, links }: { lines: readonly string[]; links?: Readonly<Record<string, string>> }) {
  const shown = gameOrder(lines);
  return (
    <>
      {shown.map((line, i) => {
        if (line === "Help confirm these values: install the addon at /addon.") return <p key={i}>Help confirm these values: <a className="underline" href="/addon">install the addon</a>.</p>;
        const t = tipLine(line);
        const href = links?.[line];
        const text = (s: string) => (href ? <a href={href} className="hover:underline focus-visible:underline">{s}</a> : s);
        if (t.kind === "pair") {
          return (
            <p key={i} data-tip-pair className="flex justify-between gap-4">
              <span>{t.left}</span>
              <span className="sr-only">, </span>
              <span className="text-right">{t.right}</span>
            </p>
          );
        }
        if (t.kind === "price") {
          return (
            <p key={i}>
              {t.label}
              {" "}<CoinText text={line.slice(t.label.length).trim()} />
            </p>
          );
        }
        // The game leaves a blank line above a set's name and above its first bonus.
        const gap = (t.kind === "yellow" && SET_HEAD.test(line)) || (t.kind === "bonus" && i > 0 && tipLine(shown[i - 1]).kind !== "bonus");
        const tone = [gap ? "mt-2" : "", TONE[t.kind] ?? ""].filter(Boolean).join(" ") || undefined;
        // A number still waiting for a third install keeps its mark, set apart from the game's own words.
        const mark = t.kind === "stat" ? UNCONFIRMED_MARK.exec(t.text) : null;
        if (mark) return <p key={i} className={tone}>{t.text.slice(0, mark.index)} <span data-unconfirmed className="text-xs text-muted">{mark[1]}</span></p>;
        return <p key={i} className={tone}>{text(t.text)}</p>;
      })}
    </>
  );
}
