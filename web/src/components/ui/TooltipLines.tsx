import { gameOrder, tipLine, type Metal } from "@/lib/tip-line";

const COIN_TEXT: Record<Metal, string> = { gold: "text-coin-gold", silver: "text-coin-silver", copper: "text-coin-copper" };
const COIN_FILL: Record<Metal, string> = { gold: "bg-coin-gold", silver: "bg-coin-silver", copper: "bg-coin-copper" };

/**
 * A coin after its amount: a disc in the metal's colour with its letter (g, s, c) on it, so the metal reads without
 * the colour. Screen readers hear the metal's name.
 */
function Coin({ metal }: { metal: Metal }) {
  return (
    <span role="img" aria-label={metal} className={`ml-0.5 inline-flex size-3 items-center justify-center rounded-full align-[-1px] text-[9px] font-bold leading-none text-tooltip ${COIN_FILL[metal]}`}>
      {metal[0]}
    </span>
  );
}

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
              {t.coins.map((c) => (
                <span key={c.metal} className="tabular-nums">
                  {" "}
                  <span className={COIN_TEXT[c.metal]}>{c.amount}</span>
                  <Coin metal={c.metal} />
                </span>
              ))}
            </p>
          );
        }
        const tone = t.kind === "effect" ? "text-q-uncommon" : t.kind === "yellow" ? "text-tip-yellow" : undefined;
        return <p key={i} className={tone}>{t.text}</p>;
      })}
    </>
  );
}
