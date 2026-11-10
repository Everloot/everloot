import { tipLine, type Metal } from "@/lib/tip-line";

const COLOUR: Record<Metal, string> = { gold: "text-coin-gold", silver: "text-coin-silver", copper: "text-coin-copper" };

/** Flat coin artwork for the three metals; the served asset manifest has no currency art. */
export function Coin({ metal }: { metal: Metal }) {
  return <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" className={`ml-0.5 inline-block align-[-1px] ${COLOUR[metal]}`}>
    <circle cx="6" cy="6" r="5.5" fill="currentColor" />
    <circle cx="6" cy="6" r="4" fill="none" className="text-tooltip" stroke="currentColor" />
    <path d="M6 3.5 8 6 6 8.5 4 6Z" fill="currentColor" className="text-tooltip" />
  </svg>;
}

/** A formatted price keeps its text for assistive technology and uses coins visually. */
export function CoinText({ text }: { text: string }) {
  const parsed = tipLine(`Sell Price: ${text.replace(/^-/, "")}`);
  if (parsed.kind !== "price") return text;
  return <span className="whitespace-nowrap tabular-nums">
    <span className="sr-only">{text.startsWith("-") ? "minus " : ""}{parsed.coins.map((c) => `${c.amount} ${c.metal}`).join(" ")}</span>
    <span aria-hidden="true">{text.startsWith("-") && "-"}{parsed.coins.map((c, i) => <span key={c.metal}>{i > 0 && " "}{c.amount}<Coin metal={c.metal} /></span>)}</span>
  </span>;
}

export default function Coins({ copper }: { copper: number | null }) {
  if (copper === null) return "unrecorded";
  const value = Math.round(Math.abs(copper));
  const g = Math.floor(value / 10000), s = Math.floor(value % 10000 / 100), c = value % 100;
  return <CoinText text={`${copper < 0 ? "-" : ""}${g ? `${g}g ` : ""}${g || s ? `${s}s ` : ""}${c}c`} />;
}

/** Money inside a prose answer retains its line breaks and surrounding words. */
export function MoneyText({ text }: { text: string }) {
  return text.split(/(-?(?:\d+g )?(?:\d+s )?\d+c)\b/g).map((part, i) => <CoinText key={i} text={part} />);
}
