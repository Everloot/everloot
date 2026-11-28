"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { marketRealmsResponse, type AuctionHouse } from "@everloot/protocol";
import Link from "@/components/Link";
import { Card, Disclosure, SectionHeading } from "@/components/ui";
import { realmDisplayName } from "../../auctions/RealmName";
import {
  inventoryMoney, lookupInventoryPrices, MAX_INVENTORY_ITEMS, MAX_QUOTE_AGE_DAYS, parseInventory,
  PRICE_API, type InventoryPrices, type ItemCount, type Market,
} from "./inventory";

const FIELD = "min-h-11 w-full min-w-0 rounded-control border border-edge bg-canvas px-3 py-2 text-base text-fg focus:border-accent";
const LINK = "underline decoration-edge underline-offset-4 hover:decoration-fg";
const houseLabel = (house: AuctionHouse) => house === "Neutral" ? "Blackwater" : house;

type InventoryResult = InventoryPrices & { market: Market; items: ItemCount[] };

function Results({ result }: { result: InventoryResult }) {
  const { items, market, quotes, unavailable } = result;
  const rows = items.map(({ itemId, quantity }) => {
    const quote = quotes.get(itemId);
    const value = quote && quote[8] <= MAX_QUOTE_AGE_DAYS ? BigInt(quote[2]) * BigInt(quantity) : null;
    return { itemId, quantity, quote, value };
  });
  const priced = rows.filter(({ value }) => value !== null).length;
  const subtotal = rows.reduce((sum, { value }) => sum + (value ?? 0n), 0n);
  return (
    <section aria-labelledby="valuation-results" className="space-y-4">
      <SectionHeading id="valuation-results" note={`${realmDisplayName(market.realm)} · ${houseLabel(market.house)} auction house`}>Inventory estimate</SectionHeading>
      <Card padding="sm" role="status" className="space-y-1">
        <p className="text-sm text-fg-2">{priced === items.length ? "Estimated total" : priced > 0 ? "Known subtotal" : "No current quotes"}</p>
        {priced > 0 && <p className="break-words text-xl font-semibold tabular-nums text-fg">{inventoryMoney(subtotal)}</p>}
        <p className="text-sm text-fg-2">{`${priced} of ${items.length} item types have a current quote.`}</p>
        {unavailable.size > 0 && <p className="text-sm text-fg-2">Some prices could not be retrieved. Wait a moment and try again.</p>}
      </Card>
      <p className="text-sm text-fg-2">
        Uses the latest public minimum buyout per unit, calculated from <Link href="/tools/auctions" className={LINK}>players&apos; auction scans</Link>.
        The estimate includes quotes up to {MAX_QUOTE_AGE_DAYS} days old (UTC) and leaves out binding status, fees, stack sizes and available stock.
      </p>
      <Card padding="none">
        <ul aria-label="Inventory items" role="list" className="divide-y divide-line">
          {rows.map(({ itemId, quantity, quote, value }) => (
            <li key={itemId} className="grid min-w-0 gap-1 px-4 py-3 text-sm sm:grid-cols-[minmax(8rem,1fr)_minmax(0,2fr)_minmax(7rem,1fr)] sm:gap-x-4">
              <p className="break-words"><Link href={`/database/items/${itemId}`} className={LINK}>Item {itemId}</Link> <span className="text-muted">× {quantity.toLocaleString("en-US")}</span></p>
              {quote ? (
                <p className="break-words text-fg-2">
                  {inventoryMoney(BigInt(quote[2]))} each · <time dateTime={quote[5]}>{quote[5]}</time>
                  {quote[6] < 3 && " · includes Everloot's own scans"}
                </p>
              ) : <p className="text-muted">{unavailable.has(itemId) ? "Quote request unavailable" : "No public quote"}</p>}
              {quote && (value === null ? <p className="text-muted sm:text-right">Quote too old</p> : <p className="break-words font-semibold tabular-nums sm:text-right">{inventoryMoney(value)}</p>)}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

export default function InventoryValue() {
  const [houses, setHouses] = useState<Record<string, AuctionHouse[]> | null>(null);
  const [marketError, setMarketError] = useState(false);
  const [marketRequest, setMarketRequest] = useState(0);
  const [realm, setRealm] = useState("");
  const [house, setHouse] = useState<AuctionHouse | "">("");
  const [text, setText] = useState("");
  const [inputError, setInputError] = useState("");
  const [result, setResult] = useState<InventoryResult | null>(null);
  const [valuing, setValuing] = useState(false);
  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    void fetch(PRICE_API, { signal: abort.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Market discovery failed.");
      const parsed = marketRealmsResponse.safeParse(await response.json());
      if (!parsed.success || !parsed.data.houses) throw new Error("Market discovery returned no house list.");
      if (!abort.signal.aborted) setHouses(parsed.data.houses);
    }).catch(() => { if (!abort.signal.aborted) setMarketError(true); });
    return () => abort.abort();
  }, [marketRequest]);

  useEffect(() => () => active.current?.abort(), []);

  const choices = houses?.[realm] ?? [];
  const realms = Object.entries(houses ?? {}).filter(([, listed]) => listed.length > 0).map(([name]) => name).sort();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!realm || !house || !choices.includes(house) || active.current) return;
    const parsed = parseInventory(text);
    if (!parsed.ok) {
      setInputError(parsed.error);
      return;
    }
    setInputError("");
    setResult(null);
    const abort = new AbortController();
    active.current = abort;
    setValuing(true);
    const market = { realm, house };
    const priced = await lookupInventoryPrices(parsed.items, market, abort.signal);
    if (!abort.signal.aborted) {
      setResult({ ...priced, market, items: parsed.items });
      setValuing(false);
    }
    active.current = null;
  }

  return (
    <div className="space-y-6">
      <Card padding="sm" className="space-y-4">
        <form className="space-y-4" onSubmit={submit}>
          <fieldset disabled={valuing} className="min-w-0 space-y-4">
            <legend className="sr-only">Inventory and auction house</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="min-w-0 space-y-1 text-sm text-fg-2" htmlFor="inventory-realm">
                <span className="block">Realm</span>
                <select id="inventory-realm" className={FIELD} value={realm} onChange={(event) => { setRealm(event.target.value); setHouse(""); setResult(null); }}>
                  <option value="">Choose a realm</option>
                  {realms.map((name) => <option key={name} value={name}>{realmDisplayName(name)}</option>)}
                </select>
              </label>
              <label className="min-w-0 space-y-1 text-sm text-fg-2" htmlFor="inventory-house">
                <span className="block">Auction house</span>
                <select id="inventory-house" disabled={!realm} className={FIELD} value={house} onChange={(event) => {
                  setHouse(choices.find((choice) => choice === event.target.value) ?? "");
                  setResult(null);
                }}>
                  <option value="">Choose an auction house</option>
                  {choices.map((choice) => <option key={choice} value={choice}>{houseLabel(choice)}</option>)}
                </select>
              </label>
            </div>
            {!houses && !marketError && <p className="text-sm text-muted" role="status">Loading auction houses…</p>}
            {marketError && <p className="text-sm text-fg-2" role="status">Auction houses are unavailable. <button type="button" className={LINK} onClick={() => { setMarketError(false); setMarketRequest((request) => request + 1); }}>Retry</button></p>}
            {houses && !realms.length && <p className="text-sm text-fg-2" role="status">No auction house has public prices yet.</p>}
            <div className="space-y-1">
              <label htmlFor="inventory-list" className="block text-sm text-fg-2">Inventory list</label>
              <p id="inventory-format" className="text-sm text-muted">Paste an addon export or enter an item ID and quantity per line. Up to {MAX_INVENTORY_ITEMS} different items.</p>
              <textarea id="inventory-list" aria-describedby="inventory-format inventory-privacy" aria-invalid={!!inputError} rows={5} className={`${FIELD} font-mono`} autoComplete="off" spellCheck={false}
                value={text} placeholder={"2589 3\n4306 12"} onChange={(event) => { setText(event.target.value); setInputError(""); setResult(null); }} />
              <p id="inventory-privacy" className="text-sm text-muted">The price lookup sends only item IDs and your market selection. Quantities and the pasted text stay in this tab.</p>
            </div>
          </fieldset>
          {inputError && <p role="alert" className="text-sm text-warning">{inputError}</p>}
          <button type="submit" disabled={!house || valuing} className="btn btn-primary min-h-11">Value inventory</button>
          {valuing && <p className="text-sm text-fg-2" role="status">Looking up asking prices…</p>}
        </form>
        <Disclosure summary="Export from the addon">
          <p className="text-sm">On addon builds with inventory export, enable Local inventory snapshots. Use <code className="font-mono">/everloot bagcheck</code> for bags, or <code className="font-mono">/everloot bagcheck bank</code> with the bank open. Copy the export and paste it above.</p>
        </Disclosure>
      </Card>
      {result && <Results result={result} />}
    </div>
  );
}
