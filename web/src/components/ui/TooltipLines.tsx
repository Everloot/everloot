import { CoinText } from "./Coins";
import { gameOrder, tipLine } from "@/lib/tip-line";

/**
 * An item tooltip's lines laid out as the game draws them (lib/tip-line.ts): slot and kind, and damage and speed, in
 * two columns; Equip, Use and Chance on hit lines in green; the item level, a set and the flavour text in yellow; the
 * sell price in coins. The item level is drawn first, under the name, as the game does (`gameOrder`); the lines passed
 * in keep the order they are served in. Every line keeps its words, so no colour is the only signal, and the reading
 * order is the visual order. Any other line is drawn as it is.
 */
export default function TooltipLines({ lines }: { lines: readonly string[] }) {
  return (
    <>
      {gameOrder(lines).map((line, i) => {
        if (line === "Help confirm these values: install the addon at /addon.") return <p key={i}>Help confirm these values: <a className="underline" href="/addon">install the addon</a>.</p>;
        const t = tipLine(line);
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
        const tone = t.kind === "effect" ? "text-q-uncommon" : t.kind === "yellow" ? "text-tip-yellow" : undefined;
        return <p key={i} className={tone}>{t.text}</p>;
      })}
    </>
  );
}
