import { CoinText } from "./Coins";
import { gameOrder, tipLine, type TipLine } from "@/lib/tip-line";

const TONE: Partial<Record<TipLine["kind"], string>> = {
  effect: "text-q-uncommon", yellow: "text-tip-yellow", stat: "text-fg", piece: "pl-2.5 text-muted", bonus: "text-muted",
};

/**
 * An item tooltip's lines laid out as the game draws them (lib/tip-line.ts): slot and kind, and damage and speed, in
 * two columns; Equip, Use and Chance on hit lines in green; the item level, a set and the flavour text in yellow; the
 * sell price in coins. The item level is drawn first, under the name, as the game does (`gameOrder`); the lines passed
 * in keep the order they are served in. Every line keeps its words, so no colour is the only signal, and the reading
 * order is the visual order. Stats and armour with their numbers in white; a set's pieces, indented, and its bonuses
 * in grey. `links` turns a line into a link to its page (the item page's box: the set and its pieces); the hover card
 * takes no pointer, so it passes none. Any other line is drawn as it is.
 */
export default function TooltipLines({ lines, links }: { lines: readonly string[]; links?: Readonly<Record<string, string>> }) {
  return (
    <>
      {gameOrder(lines).map((line, i) => {
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
        const tone = TONE[t.kind];
        return <p key={i} className={tone}>{text(t.text)}</p>;
      })}
    </>
  );
}
