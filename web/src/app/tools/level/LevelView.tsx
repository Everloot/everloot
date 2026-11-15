"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CopyButton, SectionHeading } from "@/components/ui";
import { LEVELS, levelHref, type LevelClass, type LevelPlace, type LevelUnlocks } from "@/lib/level-unlocks";
const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const SLOT = "everloot.level.class";

function Places({ places }: { places: readonly LevelPlace[] }) {
  return <ul className="space-y-2 text-sm">{places.map((p) => <li key={p.href}>
    <Link href={p.href} className={LINK}>{p.name}</Link>
    <span className="text-muted">{p.min === p.max ? ` · Level ${p.min}` : ` · Levels ${p.min}–${p.max}`}</span>
  </li>)}</ul>;
}

/** The server emits all classes. Query and device preferences filter that static result in the browser. */
export default function LevelView({ level, unlocks, classes }: { level: number; unlocks: LevelUnlocks; classes: readonly LevelClass[] }) {
  const [selected, setSelected] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    const restore = () => {
      const query = new URLSearchParams(window.location.search).get("class");
      let value = query;
      if (value === null) { try { value = window.localStorage.getItem(SLOT); } catch { /* Storage may be disabled. */ } }
      const valid = value === "all" || classes.some((c) => c.slug === value) ? value! : "";
      setSelected(valid);
      if (query !== null && valid) { try { window.localStorage.setItem(SLOT, valid); } catch { /* The URL still works. */ } }
    };
    restore(); window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [classes]);
  const choose = (value: string) => {
    setSelected(value); setCopyStatus("");
    const url = new URL(window.location.href); url.searchParams.set("class", value);
    window.history.replaceState(null, "", url);
    try { window.localStorage.setItem(SLOT, value); } catch { /* Filtering does not require storage. */ }
  };
  const shareLink = () => {
    const url = new URL(window.location.href);
    if (selected) url.searchParams.set("class", selected);
    return url.href;
  };
  const matches = (slug?: string) => !selected || selected === "all" || !slug || slug === selected;
  const spells = unlocks.spells?.filter((s) => matches(s.classSlug));
  const talents = unlocks.talents.filter((t) => matches(t.slug));
  const trainers = unlocks.trainers?.filter((t) => matches(t.classSlug));
  return <div className="space-y-10">
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">Class
          <select aria-label="Class" value={selected || "all"} onChange={(e) => choose(e.target.value)} className="min-h-11 rounded-control border border-line bg-panel px-3 text-fg">
            <option value="all">All classes</option>{classes.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">Jump to level
          <select aria-label="Jump to level" value={level} onChange={(e) => window.location.assign(levelHref(Number(e.target.value), selected))} className="min-h-11 rounded-control border border-line bg-panel px-3 text-fg">
            {LEVELS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <CopyButton text={shareLink} label="Copy link" failedLabel="Copy failed" className="btn min-h-11" onResult={(ok) => setCopyStatus(ok ? "Link copied." : "Could not copy. Copy this page’s address from your browser.")} />
        <span role="status" className="text-sm text-muted">{copyStatus}</span>
      </div>
      <nav aria-label="Level navigation" className="flex flex-wrap items-center gap-6 text-sm">
        {level > 1 && <Link aria-label="Previous level" href={levelHref(level - 1, selected)} className={`inline-flex min-h-11 items-center ${LINK}`}>← Level {level - 1}</Link>}
        <Link href="/tools/level" className={`inline-flex min-h-11 items-center ${LINK}`}>All levels</Link>
        {level < 60 && <Link aria-label="Next level" href={levelHref(level + 1, selected)} className={`inline-flex min-h-11 items-center ${LINK}`}>Level {level + 1} →</Link>}
      </nav>
      <p className="text-sm text-muted">Your last class is remembered on this device when browser storage is available.</p>
    </div>
    <section aria-labelledby="level-talents">
      <SectionHeading id="level-talents">Talent points</SectionHeading>
      {talents.length ? <ul className="space-y-2 text-sm">{talents.map((t) => <li key={t.slug}>
        <span>{t.name}: {t.gained} new {t.gained === 1 ? "point" : "points"}, {t.total} total. </span>
        <Link href={`/tools/talents/${t.slug}`} className={LINK}>{t.name} talent calculator</Link>{" · "}
        <Link href={`/classes/${t.slug}`} className={LINK}>{t.name} hub</Link>
      </li>)}</ul> : <p className="text-sm text-muted">No new talent points at this level in the available class data.</p>}
      <p className="mt-3 text-sm text-muted">Point levels come from the talent catalogs’ game tables, found in game files, unconfirmed.</p>
    </section>
    {spells ? <section aria-labelledby="level-spells">
      <SectionHeading id="level-spells">New trainer spells and ranks</SectionHeading>
      {spells.length ? <ul className="space-y-2 text-sm">{spells.map((s) => <li key={`${s.classSlug}-${s.id}`}><Link className={LINK} href={s.href}>{s.name}{s.rank ? ` · ${s.rank}` : ""}</Link></li>)}</ul>
        : <p className="text-sm text-muted">No trainer spells recorded at this level for this selection.</p>}
    </section> : <p className="text-sm text-muted">Not confirmed yet: trainer spells and ranks. The class spell data has no learning levels or trainer offerings.</p>}
    <section aria-labelledby="level-dungeons">
      <SectionHeading id="level-dungeons">Dungeons with a recorded range covering {level}</SectionHeading>
      {unlocks.dungeons.length ? <Places places={unlocks.dungeons} /> : <p className="text-sm text-muted">No dungeon in the available data has a recorded range covering this level.</p>}
      <p className="mt-3 text-sm text-muted">ContentTuning ranges from the game files, unconfirmed. These are not confirmed entry requirements or recommendations; a single recorded level is shown as given.</p>
    </section>
    {level === 60 && <section aria-labelledby="level-raids">
      <SectionHeading id="level-raids">Raids with a recorded range covering 60</SectionHeading>
      {unlocks.raids.length ? <Places places={unlocks.raids} /> : <p className="text-sm text-muted">No raid range covering 60 is recorded yet.</p>}
      <p className="mt-3 text-sm text-muted">Found in game files, unconfirmed. Raids without a recorded level range are left out.</p>
    </section>}
    {unlocks.zones ? <section aria-labelledby="level-zones"><SectionHeading id="level-zones">Zones covering this level</SectionHeading>
      {unlocks.zones.length ? <Places places={unlocks.zones} /> : <p className="text-sm text-muted">No zone range covering this level is recorded.</p>}
    </section> : <p className="text-sm text-muted">Not confirmed yet: zone level ranges.</p>}
    {trainers ? <section aria-labelledby="level-training"><SectionHeading id="level-training">Other training</SectionHeading>
      <ul className="space-y-2 text-sm">{trainers.map((t) => <li key={t.href}><Link href={t.href} className={LINK}>{t.name}</Link></li>)}</ul>
    </section> : <p className="text-sm text-muted">Not confirmed yet: character levels for professions, riding and other trainers.</p>}
    <section aria-labelledby="level-plan"><SectionHeading id="level-plan">Plan your class</SectionHeading>
      <ul className="space-y-2 text-sm">{classes.filter((c) => matches(c.slug)).map((c) => <li key={c.slug}>
        <Link href={`/tools/talents/${c.slug}`} className={LINK}>{c.name} talent calculator</Link>{" · "}
        <Link href={`/classes/${c.slug}`} className={LINK}>{c.name} hub</Link>
      </li>)}</ul>
    </section>
  </div>;
}
