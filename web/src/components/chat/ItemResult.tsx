"use client";

import { useEffect, useState } from "react";
import { GameCard, type CardContent } from "@/components/game/GameCard";
import { suggestItems, type ItemChoice, type ItemRef } from "@/lib/chat/items";
import { pendingLine, type PendingCount } from "../../../../kb/src/pending-loot";

// An answer's item inside Chat: the site's own card (/database/card/item/<id>) and the drops the player-data tool
// publishes (/api/tools/item_page), fetched fresh each time the answer is shown. Both stay on this page: nothing
// here goes into the conversation's text, the model's messages or its tools.

interface Drop { sourceNpcId?: number; sourceObjectId?: number; source: string; kills: number; drops: number; rate: number; reporters: number }
type Drops =
  | { state: "loading" | "unavailable" }
  | { state: "ok"; asOf: string | null; drops: Drop[]; pending: PendingCount | null };
type Card = { state: "loading" | "missing" | "unavailable" } | { state: "ok"; card: CardContent };

const link = "underline underline-offset-4 hover:text-accent";
const count = (n: number) => n.toLocaleString("en-US");
const ICON_HOST = /^(?:\/(?![\/\\])|https:\/\/assets\.everloot\.app\/)/;

async function loadCard(id: number, signal: AbortSignal): Promise<Card> {
  const res = await fetch(`/database/card/item/${id}`, { signal });
  if (res.status === 404) return { state: "missing" };
  if (!res.ok) return { state: "unavailable" };
  const card = ((await res.json()) as { card?: CardContent }).card;
  if (!card || typeof card.title !== "string" || !Array.isArray(card.lines)) return { state: "unavailable" };
  // The protected page's policy loads images from this site and its asset bucket only.
  return { state: "ok", card: { ...card, icon: card.icon && ICON_HOST.test(card.icon) ? card.icon : null } };
}

async function loadDrops(id: number, signal: AbortSignal): Promise<Drops> {
  const res = await fetch(`/api/tools/item_page?itemId=${id}`, { signal, headers: { accept: "application/json" } });
  if (!res.ok) return { state: "unavailable" };
  const answer = ((await res.json()) as { answer?: { connected?: boolean; dataAsOf?: string | null; page?: { drops?: Drop[]; pendingLoot?: PendingCount } } }).answer;
  // Not connected is storage that could not be read: unrecorded, not empty.
  if (!answer?.connected || !answer.page || !Array.isArray(answer.page.drops)) return { state: "unavailable" };
  const pending = answer.page.pendingLoot && answer.page.pendingLoot.windows > 0 ? answer.page.pendingLoot : null;
  return { state: "ok", asOf: answer.dataAsOf ?? null, drops: answer.page.drops, pending };
}

/** Where a drop came from, linked to its page when it has one. */
function sourceHref(d: Drop): string | null {
  if (d.sourceNpcId !== undefined) return `/database/npcs/${d.sourceNpcId}`;
  if (d.sourceObjectId !== undefined) return `/database/objects/${d.sourceObjectId}`;
  return null;
}

function sample(d: Drop): string {
  const reporters = `${count(d.reporters)} reporting install${d.reporters === 1 ? "" : "s"}`;
  return d.drops === 0
    ? `Not seen in ${count(d.kills)} observed loot windows, ${reporters}`
    : `${count(d.drops)} of ${count(d.kills)} observed loot windows (${(d.rate * 100).toFixed(1)}%), ${reporters}`;
}

function ItemCard({ id, onSave }: { id: number; onSave?: (id: number) => void }) {
  const [card, setCard] = useState<Card>({ state: "loading" });
  const [drops, setDrops] = useState<Drops>({ state: "loading" });

  useEffect(() => {
    const ctl = new AbortController();
    setCard({ state: "loading" });
    setDrops({ state: "loading" });
    loadCard(id, ctl.signal).then((c) => { if (!ctl.signal.aborted) setCard(c); }, () => { if (!ctl.signal.aborted) setCard({ state: "unavailable" }); });
    loadDrops(id, ctl.signal).then((d) => { if (!ctl.signal.aborted) setDrops(d); }, () => { if (!ctl.signal.aborted) setDrops({ state: "unavailable" }); });
    return () => ctl.abort();
  }, [id]);

  const page = `/database/items/${id}`;
  return (
    <section aria-label="Item" aria-busy={card.state === "loading" || drops.state === "loading"} data-no-hover-card className="max-w-md space-y-3 rounded-card border border-line bg-panel p-3 text-sm">
      {card.state === "ok" && <GameCard card={card.card} />}
      {card.state === "loading" && <p className="text-muted">Loading the item card…</p>}
      {card.state === "missing" && <p className="text-muted">No card for this item yet.</p>}
      {card.state === "unavailable" && <p className="text-muted">The item card is unavailable right now.</p>}

      <div className="space-y-1">
        <h3 className="text-xs font-semibold text-fg-2">Known drops</h3>
        {drops.state === "loading" && <p className="text-muted">Loading drops…</p>}
        {drops.state === "unavailable" && <p className="text-muted">Drop data is unavailable right now. That does not mean the item has no drops.</p>}
        {drops.state === "ok" && (
          <>
            {drops.drops.length === 0
              ? <p className="text-fg">{drops.pending ? "No published drops yet." : "No drops recorded yet."} A source is published once 3 installs have reported loot from it.</p>
              : (
                <ul className="space-y-1">
                  {drops.drops.map((d, i) => {
                    const href = sourceHref(d);
                    return (
                      <li key={i} className="text-fg">
                        {href ? <a href={href} className={link}>{d.source}</a> : d.source}
                        <span className="text-fg-2">: {sample(d)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            {drops.drops.length > 0 && <p className="text-xs text-muted">Rates are observed samples, not the game&apos;s drop rate.</p>}
            {drops.pending && (
              <p className="text-xs text-muted">{pendingLine(drops.pending, true)}</p>
            )}
            {drops.asOf && <p className="text-xs text-muted">Player data as of {drops.asOf.slice(0, 10)}.</p>}
          </>
        )}
      </div>

      {onSave ? (
        <div className="flex flex-wrap gap-x-3 text-xs">
          <a href={page} className={link}>Open in the database</a>
          <button type="button" className={`min-h-9 ${link}`} onClick={() => onSave(id)}>Save item to a project</button>
        </div>
      ) : <a href={page} className={`${link} text-xs`}>Open in the database</a>}
    </section>
  );
}

function Choices({ query, onChoose }: { query: string; onChoose: (id: number) => void }) {
  const [choices, setChoices] = useState<ItemChoice[] | "loading" | "unavailable">("loading");

  useEffect(() => {
    const ctl = new AbortController();
    setChoices("loading");
    suggestItems(query, ctl.signal).then(
      (rows) => { if (!ctl.signal.aborted) setChoices(rows); },
      () => { if (!ctl.signal.aborted) setChoices("unavailable"); },
    );
    return () => ctl.abort();
  }, [query]);

  const search = `/search?${new URLSearchParams({ q: query })}`;
  if (choices === "loading") return <p className="text-sm text-muted">Looking for items named {query}…</p>;
  // suggestItems reads a failed request as no rows; either way the search page can take it from here.
  if (choices === "unavailable" || choices.length === 0) {
    return <p className="text-sm text-muted">No item choices could be shown right now. <a href={search} className={link}>Search for {query}</a></p>;
  }
  return (
    <div role="group" aria-label="Which item did you mean?" data-no-hover-card className="space-y-2">
      <p className="text-sm text-fg-2">Which item did you mean?</p>
      <ul className="flex flex-wrap gap-2">
        {choices.map((c) => <li key={c.id}><button type="button" className="btn min-h-9 px-3 text-sm" onClick={() => onChoose(c.id)}>{c.label}</button></li>)}
      </ul>
    </div>
  );
}

/** An answer's item: its card and drops, or the items its name could mean. `onSave` keeps the item's page in a project. */
export default function ItemResult({ item, onChoose, onSave }: { item: ItemRef; onChoose: (id: number) => void; onSave?: (id: number) => void }) {
  return "id" in item ? <ItemCard id={item.id} onSave={onSave} /> : <Choices query={item.query} onChoose={onChoose} />;
}
