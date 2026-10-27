"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CLASS_TEXT } from "@/components/talents/TalentTreeView";
import { Card, CopyButton, SectionHeading, Segmented } from "@/components/ui";
import { CLASSES } from "@/design/tokens";
import { CURRENT_BUILD, TABLES } from "@/data/game-data/raid";
import { classHubHref, classLabel, type ClassSlug } from "@/lib/class-context";
import {
  EMPTY_GROUP, GROUP_SIZES, absentClasses, addClass, classCounts, groupCoverage, groupHash, groupHref, parseGroup, partiesOf, raidHref,
  raidSizeFor, removeClass, withSize, type GroupPlan, type GroupSize, type Talent,
} from "@/lib/class-group";
import { GROUP_SIZE } from "@/lib/raid";
import type { GuideRole } from "../../../../../kb/src/guides/guide";

const table = TABLES[CURRENT_BUILD];
const LARGEST = GROUP_SIZES[GROUP_SIZES.length - 1];
/** The note that says why the Add buttons are unavailable; they point at it while the group is full. */
const FULL_NOTE = "group-full";
const SIZE_CONTROL = '[aria-label="Group size"] [aria-pressed="true"]';
const LINK = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
const ROLE: Record<GuideRole, string> = { tank: "Tank", healer: "Healer", damage: "Damage" };

/** "a, b and c". */
const list = (words: string[]) => (words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : words[0] ?? "");
const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");
/** An effect's name, with the talent a class needs for it. */
const withTalent = (label: string, talent: Talent) => (talent ? `${label} (${talent.tree ? `${talent.tree} talent` : "a talent, tree not known"})` : label);
/** Why a full group takes no more: the note under the classes, and the status line when an Add is pressed anyway. */
const fullNote = (size: GroupSize) => `All ${size} places are filled. Remove a class${size < LARGEST ? " or choose a larger group" : ""} to add another.`;
/** The places a group has left, as the status line says them after a change. */
const places = ({ size, classes }: GroupPlan) =>
  classes.length < size ? `${classes.length} of ${size} places filled, ${size - classes.length} open.` : `All ${size} places are filled.`;
const partyOf = (index: number) => Math.floor(index / GROUP_SIZE) + 1;
/** Puts the group in the address, which is then its link: the size and the classes, nothing else. Fires no hashchange. */
const showInAddress = (plan: GroupPlan) => history.replaceState(null, "", `${location.pathname}${location.search}${groupHash(plan)}`);

/**
 * The group planner: a size, the classes in parties of five, and what they bring. The group lives in the address's
 * fragment, so the address is the link to share; it holds the size and the classes and nothing else, and the planner
 * makes no request. `roles` are the ones each class's reviewed guides are written for, read while the site builds.
 */
export default function GroupPlanner({ roles }: { roles: Record<ClassSlug, GuideRole[]> }) {
  const [plan, setPlan] = useState<GroupPlan>(EMPTY_GROUP);
  const [error, setError] = useState<string | null>(null);
  // What the last change did, for the status line; it is in the page from the start, so a screen reader hears each one.
  const [said, setSaid] = useState("");

  useEffect(() => {
    // Read once the page is in the browser, and again when a link is pasted into the address bar of this tab. Each read
    // writes back the group it opened, even one already shown, so nothing else the link carried stays in the address.
    const read = () => {
      const opened = parseGroup(new URLSearchParams(location.hash.slice(1)));
      const shown = opened.ok ? opened.plan : EMPTY_GROUP;
      showInAddress(shown);
      setPlan(shown);
      setError(opened.ok ? null : opened.error);
      setSaid("");
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const edit = (next: GroupPlan) => {
    showInAddress(next);
    setPlan(next);
    setError(null);
  };

  // An Add or Clear that goes unavailable stays focusable (aria-disabled), so focus stays where the player pressed.
  // A Remove goes with the last place filled: focus then moves to the first of these that the next render has.
  const root = useRef<HTMLDivElement>(null);
  const refocus = useRef<string[] | null>(null);
  useLayoutEffect(() => {
    const targets = refocus.current;
    refocus.current = null;
    for (const target of targets ?? []) {
      const el = root.current?.querySelector<HTMLElement>(target);
      if (el) return el.focus();
    }
  }, [plan]);

  const add = (c: ClassSlug) => {
    const next = addClass(plan, c);
    if (next === plan) return setSaid(fullNote(plan.size));
    setSaid(`${classLabel(c)} added to party ${partyOf(plan.classes.length)}. ${places(next)}`);
    edit(next);
  };

  const remove = (index: number, hadFocus: boolean) => {
    if (hadFocus && index === plan.classes.length - 1) refocus.current = [`[data-place="${index - 1}"]`, `[data-add="${plan.classes[index]}"]`, SIZE_CONTROL];
    const next = removeClass(plan, index);
    setSaid(`${classLabel(plan.classes[index])} removed from party ${partyOf(index)}. ${places(next)}`);
    edit(next);
  };

  const clear = () => {
    if (!plan.classes.length) return;
    const next = { ...plan, classes: [] };
    setSaid(`Group cleared. ${places(next)}`);
    edit(next);
  };

  const resize = (size: GroupSize) => {
    const next = withSize(plan, size);
    if (next === plan) return;
    setSaid(`Group of ${size} players. ${places(next)}`);
    edit(next);
  };

  const filled = plan.classes.length;
  const open = plan.size - filled;
  const counts = classCounts(plan);
  const twice = counts.filter((c) => c.count > 1);
  const absent = absentClasses(plan);
  const cov = filled ? groupCoverage(plan, table) : null;
  const raidSize = raidSizeFor(plan.size);

  return (
    <div ref={root} className="space-y-8">
      {error && <p role="alert" className="text-sm text-warning">{error} This page opens an empty group instead.</p>}

      <section aria-labelledby="group" className="space-y-3">
        <h2 id="group" className="sr-only">Group</h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Segmented
            label="Group size"
            value={plan.size}
            onChange={resize}
            options={GROUP_SIZES.map((s) => ({
              value: s,
              disabled: filled > s,
              label: <>{s}<span className="sr-only">{` players${filled > s ? `, too few for ${filled} classes` : ""}`}</span></>,
            }))}
          />
          <p className="text-meta text-fg-2">{`${filled} of ${plan.size} places filled${open ? `, ${open} open` : ""}`}</p>
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <button type="button" className="btn" aria-disabled={!filled} onClick={clear}>Clear</button>
            <CopyButton className="btn btn-primary" text={() => `${location.origin}${groupHref(plan)}`} label="Copy link" />
          </div>
        </div>

        <div role="group" aria-label="Add a class" className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-9">
          {CLASSES.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Add ${classLabel(c)}`}
              aria-disabled={!open}
              aria-describedby={open ? undefined : FULL_NOTE}
              data-add={c}
              onClick={() => add(c)}
              className={`flex h-9 min-w-0 items-center rounded-control border border-edge bg-canvas px-2 text-left text-control font-medium transition-colors hover:border-fg-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${CLASS_TEXT[c]}`}
            >
              <span className="min-w-0 truncate">{classLabel(c)}</span>
            </button>
          ))}
        </div>
        {!open && <p id={FULL_NOTE} className="text-cell-2 text-muted">{fullNote(plan.size)}</p>}
        <p role="status" aria-live="polite" className="min-h-5 text-meta text-fg-2">{said}</p>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {partiesOf(plan).map((party, p) => (
            <div key={p} role="group" aria-label={`Party ${p + 1}`} className="min-w-0">
              <Card padding="none" className="p-2">
                <h3 className="mb-1.5 px-1 text-th text-muted">Party {p + 1}</h3>
                <ul className="space-y-1">
                  {party.classes.map((c, k) => (
                    <li key={k} data-member={c} className="flex h-9 min-w-0 items-center gap-2 rounded-control border border-edge bg-canvas pl-2">
                      <span className={`min-w-0 flex-1 truncate text-control font-medium ${CLASS_TEXT[c]}`}>{classLabel(c)}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${classLabel(c)} from party ${p + 1}, place ${k + 1}`}
                        data-place={p * GROUP_SIZE + k}
                        onClick={(e) => remove(p * GROUP_SIZE + k, document.activeElement === e.currentTarget)}
                        className="flex h-full w-9 shrink-0 items-center justify-center text-fg-2 hover:text-fg"
                      >
                        <span aria-hidden="true">×</span>
                      </button>
                    </li>
                  ))}
                  {Array.from({ length: party.open }, (_, k) => (
                    <li key={`open-${k}`} className="flex h-9 items-center rounded-control border border-dashed border-edge px-2 text-cell-2 text-muted">Open</li>
                  ))}
                </ul>
              </Card>
            </div>
          ))}
        </div>

        {filled > 0 && (
          <div className="space-y-1 text-sm text-fg-2">
            {twice.length > 0 && <p>{`In the group more than once: ${list(twice.map((c) => `${classLabel(c.classSlug)} (${c.count})`))}.`}</p>}
            <p>{absent.length ? `Not in the group: ${list(absent.map(classLabel))}.` : "Every class is in the group."}</p>
          </div>
        )}
      </section>

      {!cov ? (
        <p className="text-sm text-muted">Add a class to see what the group brings.</p>
      ) : (
        <>
          <section aria-labelledby="roles">
            <SectionHeading id="roles" note="A role is shown only where a reviewed guide is written for it; none is worked out from a class or its talent trees.">
              Roles from reviewed guides
            </SectionHeading>
            <ul className="space-y-1 text-sm">
              {counts.map(({ classSlug }) => (
                <li key={classSlug}>
                  <Link href={classHubHref({ classSlug })} className={`font-medium underline-offset-4 hover:underline ${CLASS_TEXT[classSlug]}`}>{classLabel(classSlug)}</Link>
                  <span className="text-fg-2">{`: ${roles[classSlug].length ? roles[classSlug].map((r) => ROLE[r]).join(", ") : "no reviewed guide yet"}`}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="brings">
            <SectionHeading id="brings">What the group brings</SectionHeading>
            {cov.brought.length === 0 && <p className="text-sm text-muted">Nothing that reaches every party yet.</p>}
            {(["buff", "debuff"] as const).map((kind) => {
              const brought = cov.brought.filter((b) => b.family.kind === kind);
              return brought.length > 0 && (
                <div key={kind} className="mb-4">
                  <h3 className="mb-1 text-th text-muted">{kind === "buff" ? "Buffs" : "Debuffs on enemies"}</h3>
                  <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
                    {brought.map((b) => (
                      <li key={b.family.id}>
                        <span className="text-fg">{b.family.label}</span>
                        <span className="text-fg-2">{` · ${list(b.classes.map(classLabel))}${b.cast ? ", one player per cast" : ""}`}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>

          <section aria-labelledby="nobody">
            <SectionHeading id="nobody">What nobody brings</SectionHeading>
            {cov.nobody.length === 0 ? (
              <p className="text-sm text-fg-2">Every effect the planner counts comes from a class in the group.</p>
            ) : (
              <>
                <p className="mb-2 text-sm text-fg-2">Nobody in the group brings these. Each line is a class that is not in the group, with what it brings in the game files.</p>
                <ul className="space-y-1 text-sm">
                  {cov.nobody.map((n) => (
                    <li key={n.classSlug}>
                      <span className={`font-medium ${CLASS_TEXT[n.classSlug]}`}>{classLabel(n.classSlug)}</span>
                      <span className="text-fg-2">{`: ${list(n.effects.map((e) => withTalent(e.family.label, e.talent)))}`}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {cov.talent.length > 0 && (
            <section aria-labelledby="talent">
              <SectionHeading id="talent">Only with a talent</SectionHeading>
              <ul className="space-y-1 text-sm text-fg-2">
                {cov.talent.map((t) => (
                  <li key={`${t.family.id}-${t.classSlug}-${t.tree}`}>{`A ${classLabel(t.classSlug)} brings ${t.family.label} only with ${article(t.tree)} ${t.tree} talent.`}</li>
                ))}
              </ul>
            </section>
          )}

          {cov.party.length > 0 && (
            <section aria-labelledby="parties">
              <SectionHeading id="parties">Not in every party</SectionHeading>
              <ul className="space-y-1 text-sm text-fg-2">
                {cov.party.map((m) => (
                  <li key={m.family.id}>
                    {`${m.family.label} reaches only its caster's party, and nobody in ${m.parties.length > 1 ? "parties" : "party"} ${list(m.parties.map(String))} brings it.`}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {cov.unknown.length > 0 && (
            <section aria-labelledby="unknown">
              <SectionHeading id="unknown">Not known</SectionHeading>
              <ul className="space-y-1 text-sm text-fg-2">
                {cov.unknown.map((u) => (
                  <li key={`${u.family.id}-${u.classSlug}`}>
                    {`A ${classLabel(u.classSlug)} brings ${u.family.label}, but ${u.reason === "reach" ? "how far it reaches is not known in this build's files" : "the files match it to talents in more than one tree"}.`}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="raid-builder">
            <SectionHeading id="raid-builder">Raid builder</SectionHeading>
            <p className="text-sm">
              <Link href={raidHref(plan, table)} className={LINK}>Open this group in the raid builder</Link>
            </p>
            <p className="mt-1 text-sm text-fg-2">
              {raidSize > plan.size && `The raid builder plans 10, 20 or 40 players, so this group of ${plan.size} opens there as group 1 of a ${raidSize}-player raid. `}
              Each player starts there on any talent tree.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
