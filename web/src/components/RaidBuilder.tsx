"use client";
import { track } from "@/lib/analytics/track";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CLASSES } from "@/design/tokens";
import { glide } from "@/lib/motion";
import { CURRENT_BUILD, TABLES, type BuffTable, type Scope } from "@/data/game-data/raid";
import {
  treeNames, SIZES, STATE_LABEL, applyDrop, coverage, decodeRaid, describeRaid, emptySlots, encodeRaid, findCode, groupsOf, resize,
  titleCase, GROUP_SIZE, roster, swapSlots,
  type ClassName, type DragSource, type DropTarget, type FamilyCoverage, type Size, type Slot, type Slots, type State,
} from "@/lib/raid";
import type { RaidArt } from "@/lib/game-assets";
import { ClassContextChipFromAddress } from "@/components/classes/ClassContextChip";
import GameIcon from "@/components/game/GameIcon";
import SpellTip from "@/components/game/SpellTip";
import { Badge, Card, CopyButton, DataTable, Input, SectionHeading, Segmented, type Column } from "@/components/ui";

const table = TABLES[CURRENT_BUILD];

// Full class-colour class names, written out so Tailwind sees them.
const CLASS_TEXT: Record<ClassName, string> = {
  warrior: "text-class-warrior", paladin: "text-class-paladin", hunter: "text-class-hunter",
  rogue: "text-class-rogue", priest: "text-class-priest", shaman: "text-class-shaman",
  mage: "text-class-mage", warlock: "text-class-warlock", druid: "text-class-druid",
};

const CLASS_BORDER: Record<ClassName, string> = {
  warrior: "border-l-class-warrior", paladin: "border-l-class-paladin", hunter: "border-l-class-hunter",
  rogue: "border-l-class-rogue", priest: "border-l-class-priest", shaman: "border-l-class-shaman",
  mage: "border-l-class-mage", warlock: "border-l-class-warlock", druid: "border-l-class-druid",
};

const STATE_TEXT: Record<State, string> = {
  covered: "text-accent", cast: "text-fg-2", possible: "text-warning", unknown: "text-warning", missing: "text-danger",
};
const STATE_SHORT: Record<State, string> = { covered: "Yes", cast: "Cast", possible: "Talent", unknown: "Unknown", missing: "No" };

const SCOPE_TEXT: Record<Scope, string> = {
  self: "caster only", single: "one player per cast", party: "party", raid: "raid", area: "players nearby",
  enemy: "enemy", mixed: "ranks differ", unknown: "reach unknown",
};
interface Snapshot { size: Size; slots: Slots }
const HISTORY_LIMIT = 100;
/** Pixels a mouse or pen moves before a press becomes a drag. */
const DRAG_THRESHOLD = 5;
/** A finger holds this long before a press becomes a drag, so a swipe still scrolls the page. */
const TOUCH_HOLD_MS = 250;
/** Within this many pixels of the window's top or bottom, a drag scrolls the page. */
const EDGE = 48;
/** Missing effects shown as chips; the rest are in the full coverage. */
const MISSING_SHOWN = 12;

function reach(f: FamilyCoverage, table: BuffTable): string {
  const scopes = [...new Set(f.entries.map((e) => SCOPE_TEXT[e.scope]))].join(", ");
  const needs = [...new Set(f.entries.flatMap((e) => {
    if (e.tree === "baseline") return [];
    if (e.tree === "unknown") return ["tree unknown"];
    return [`needs a ${table.trees[e.class]?.[e.tree - 1] ?? `tree ${e.tree}`} talent`];
  }))];
  return [scopes, ...needs].join(", ");
}

/** What is under the pointer: a slot, the trash, nothing (a gap between slots), or off the groups (the trash). */
function targetAt(x: number, y: number): DropTarget | null {
  const el = typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
  if (!el) return null;
  const slot = el.closest<HTMLElement>("[data-drop-slot]");
  if (slot) return { kind: "slot", index: Number(slot.dataset.dropSlot) };
  if (el.closest("[data-drop-trash]")) return { kind: "trash" };
  if (el.closest("[data-raid-groups]")) return null;
  return { kind: "trash" };
}

const sameTarget = (a: DropTarget | null, b: DropTarget | null) =>
  a === b || (!!a && !!b && a.kind === b.kind && (a.kind === "trash" || (b.kind === "slot" && a.index === b.index)));

interface Drag { source: DragSource; over: DropTarget | null }

/**
 * `art`: the game's class, tree and buff icons and the buffs' tooltips (lib/game-assets.ts), or null
 * without the asset URL. The icons sit beside the names, which stay; without them the builder is the
 * text it always was.
 */
/**
 * `initialCode` is the raid from a raid link (/tools/raid/r/<code>), opened when the address has no #raid=.
 * `classContext` shows a class hub's context chip on top (the planner's own page), with the raid as it is now.
 */
export default function RaidBuilder({ art = null, initialCode, classContext = false }: { art?: RaidArt | null; initialCode?: string; classContext?: boolean } = {}) {
  const classIcon = (c: ClassName, size = 20, gap = "mr-2") => {
    const src = art?.classes[c];
    return src ? <GameIcon src={src} size={size} className={gap} /> : null;
  };
  const treeIcon = (c: ClassName, tree: number, size = 20, gap = "mr-2") => {
    const src = tree > 0 ? art?.trees[c]?.[tree - 1] : null;
    return src ? <GameIcon src={src} size={size} className={gap} /> : null;
  };
  const [state, setState] = useState<Snapshot>({ size: 20, slots: emptySlots(20) });
  const [past, setPast] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  // The class picked in the palette, placed by picking a slot: the keyboard and phone path for dragging.
  const [armed, setArmed] = useState<ClassName | null>(null);
  const [linkBuild, setLinkBuild] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [paste, setPaste] = useState("");
  const [ready, setReady] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const ghostRef = useRef<HTMLDivElement>(null);
  const ghostAt = useRef({ x: 0, y: 0 });
  const stopDrag = useRef<(() => void) | null>(null);
  const dragging = useRef(false);
  const layoutRef = useRef<HTMLElement>(null);
  // A press that turned into a drag ends with a click on the button it started on; that click is not a pick.
  const suppressClick = useRef(false);
  // Members moved by moveMember, with where each was on screen; they glide there once the new slots are drawn.
  const glides = useRef<{ index: number; first: DOMRect }[]>([]);

  const { size, slots } = state;

  // Only moveMember queues glides: a size switch, Clear, a loaded link, undo and the first render land at once.
  useLayoutEffect(() => {
    const queued = glides.current;
    glides.current = [];
    for (const { index, first } of queued) {
      const el = slotRefs.current[index];
      if (el) glide(el, first);
    }
  }, [slots]);

  const commit = useCallback((next: Snapshot) => {
    setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), state]);
    setState(next);
    setLinkBuild(null);
    setMessage("");
  }, [state]);

  const undo = useCallback(() => {
    setPast((p) => {
      const last = p[p.length - 1];
      if (!last) return p;
      setState(last);
      setSelected(null);
      setLinkBuild(null);
      setMessage("Undone.");
      return p.slice(0, -1);
    });
  }, []);

  // Open a link: the plan is in the fragment, which never reaches the server.
  const load = useCallback((text: string, fromPaste: boolean) => {
    const decoded = decodeRaid(findCode(text));
    if (!decoded.ok) { setMessage(decoded.error); return; }
    const { size: s, slots: sl, build } = decoded.value;
    if (fromPaste) setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), state]);
    setState({ size: s, slots: sl });
    setSelected(null);
    setLinkBuild(build !== table.build ? build : null);
    setMessage(build !== table.build ? "" : "Raid loaded.");
  }, [state]);

  useEffect(() => {
    // A raid link carries its code in the path; move it into the planner's #raid= address and read it there.
    if (!location.hash && initialCode) history.replaceState(null, "", `/tools/raid#raid=${initialCode}`);
    if (location.hash.startsWith("#raid=")) load(location.hash.slice(6), false);
    setReady(true);
    // A link pasted into the address bar of this tab changes only the fragment. Our own updates use
    // replaceState, which does not fire this.
    const onHash = () => { if (location.hash.startsWith("#raid=")) load(location.hash.slice(6), false); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // Runs once, on first paint in the browser.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const code = useMemo(() => encodeRaid({ size, build: table.build, slots }), [size, slots]);
  const empty = slots.every((s) => !s);
  // The link handed out is the raid link: same raid, and its preview in a chat names the roster.
  const link = typeof window === "undefined" ? "" : `${location.origin}/tools/raid/r/${code}`;
  // The raid in the address, as it is now: written there below and handed to the class context chip, whose links keep it.
  const fragment = empty ? "" : `#raid=${code}`;

  useEffect(() => {
    if (!ready) return;
    history.replaceState(null, "", `${location.pathname}${location.search}${fragment}`);
  }, [ready, fragment]);

  useEffect(() => {
    if (selected !== null) pickerRef.current?.focus();
    setMoveTo("");
  }, [selected]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        undo();
      }
      if (e.key === "Escape" && armed) {
        setArmed(null);
        setMessage("Stopped placing.");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [undo, armed]);

  useEffect(() => () => stopDrag.current?.(), []);

  // Once a finger is dragging, the page must not scroll under it. The listener is in place before any touch
  // starts (a browser decides at touchstart whether a touch can block scrolling) and is non-passive.
  useEffect(() => {
    const el = layoutRef.current;
    if (!el) return;
    const onTouchMove = (ev: TouchEvent) => { if (dragging.current) ev.preventDefault(); };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, []);

  const setSlot = (index: number, slot: Slot | null) => {
    const next = [...slots];
    next[index] = slot;
    commit({ size, slots: next });
  };

  const closePicker = () => {
    const i = selected;
    setSelected(null);
    if (i !== null) slotRefs.current[i]?.focus();
  };

  const cov = useMemo(() => coverage(slots, table), [slots]);
  const ros = useMemo(() => roster(slots), [slots]);
  const roles = useMemo(() => describeRaid(size, slots).roles, [size, slots]);
  const groups = groupsOf(slots);
  const current = selected === null ? null : slots[selected];

  const place = (i: number) => `group ${Math.floor(i / GROUP_SIZE) + 1}, slot ${(i % GROUP_SIZE) + 1}`;
  const describe = (s: Slot | null) => (s ? `${titleCase(s.class)}, ${s.tree ? treeNames(table, s.class)[s.tree - 1] : "any tree"}` : "empty");

  // Move a member to another slot; an occupied target swaps places. One undo step either way. The member pushed out
  // glides to its new slot, and so does the mover when it did not arrive under the pointer (Move to).
  const moveMember = (from: number, to: number, glideMover = false) => {
    const next = swapSlots(slots, from, to);
    if (next === slots) return false;
    const mover = slots[from];
    const other = slots[to];
    const rect = (i: number) => slotRefs.current[i]?.getBoundingClientRect();
    const fromRect = rect(from);
    const toRect = rect(to);
    if (other && toRect) glides.current.push({ index: from, first: toRect });
    if (glideMover && fromRect) glides.current.push({ index: to, first: fromRect });
    commit({ size, slots: next });
    setMessage(
      mover && other
        ? `Swapped ${describe(mover)} with ${describe(other)}.`
        : `Moved ${describe(mover ?? other)} to ${place(mover ? to : from)}.`,
    );
    return true;
  };

  // One drop or one placement: the step itself is lib/raid.ts's applyDrop; this records it and says what happened.
  const drop = (source: DragSource, target: DropTarget) => {
    if (source.kind === "slot" && target.kind === "slot") return moveMember(source.index, target.index);
    const next = applyDrop(slots, source, target);
    if (next === slots) return false;
    commit({ size, slots: next });
    if (source.kind === "slot") {
      setMessage(`Removed ${describe(slots[source.index])} from ${place(source.index)}.`);
    } else if (target.kind === "slot") {
      const before = slots[target.index];
      setMessage(before
        ? `Replaced ${describe(before)} with ${titleCase(source.class)} in ${place(target.index)}.`
        : `Added ${titleCase(source.class)} to ${place(target.index)}.`);
    }
    return true;
  };
  // The window listeners of a drag outlive the render that started it; they call the latest drop.
  const dropRef = useRef(drop);
  useEffect(() => { dropRef.current = drop; });

  const moveGhost = (x: number, y: number) => {
    ghostAt.current = { x, y };
    if (ghostRef.current) ghostRef.current.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
  };

  /**
   * Pointer drag, for mouse, pen and touch alike. A mouse or pen drags once it moves a few pixels; a finger
   * holds still briefly first, so a swipe still scrolls. Releasing over a slot drops there; over the trash
   * or off the groups, a member leaves the raid; in a gap between slots, nothing happens. Escape cancels.
   */
  const startDrag = (source: DragSource) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || stopDrag.current) return;
    const touch = e.pointerType === "touch";
    const id = e.pointerId;
    const start = { x: e.clientX, y: e.clientY };
    let last = start;
    let started = false;
    let over: DropTarget | null = null;

    const begin = () => {
      started = true;
      dragging.current = true;
      setSelected(null);
      moveGhost(last.x, last.y);
      setDrag({ source, over: null });
    };
    const timer = touch ? window.setTimeout(begin, TOUCH_HOLD_MS) : undefined;

    const stop = () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("contextmenu", onContextMenu);
      stopDrag.current = null;
      dragging.current = false;
      setDrag(null);
      if (started) {
        suppressClick.current = true;
        window.setTimeout(() => { suppressClick.current = false; }, 0);
      }
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      last = { x: ev.clientX, y: ev.clientY };
      if (!started) {
        if (Math.hypot(last.x - start.x, last.y - start.y) < DRAG_THRESHOLD) return;
        if (touch) { stop(); return; } // a swipe before the hold: the page scrolls
        begin();
      }
      moveGhost(last.x, last.y);
      const target = targetAt(last.x, last.y);
      if (!sameTarget(target, over)) {
        over = target;
        setDrag({ source, over: target });
      }
      if (last.y < EDGE) window.scrollBy(0, -12);
      else if (last.y > window.innerHeight - EDGE) window.scrollBy(0, 12);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      const wasDragging = started;
      stop();
      if (!wasDragging) return;
      const target = targetAt(ev.clientX, ev.clientY);
      if (target) dropRef.current(source, target);
    };
    const onCancel = (ev: PointerEvent) => { if (ev.pointerId === id) stop(); };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || !started) return;
      ev.stopPropagation();
      stop();
      setMessage("Drag cancelled.");
    };
    const onContextMenu = (ev: Event) => { if (touch) ev.preventDefault(); };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("contextmenu", onContextMenu);
    stopDrag.current = stop;
  };

  const pickClass = (c: ClassName) => {
    if (suppressClick.current) return;
    setSelected(null);
    if (armed === c) {
      setArmed(null);
      setMessage("Stopped placing.");
    } else {
      setArmed(c);
      setMessage(`${titleCase(c)} picked. Choose a slot, or press Escape to stop.`);
    }
  };

  const pickSlot = (index: number) => {
    if (suppressClick.current) return;
    if (armed) { drop({ kind: "class", class: armed }, { kind: "slot", index }); return; }
    setSelected(selected === index ? null : index);
  };

  const onCopied = (ok: boolean) => {
    setMessage(ok ? "Link copied." : "Select the link and copy it.");
    if (ok) track("raid_comp_shared", { via: "copy" });
  };

  // The effect's name, with the game's tooltip on hover and keyboard focus when the page has it, and how far it reaches.
  const effectCell = (f: FamilyCoverage) => (
    <span className="block min-w-[12rem]">
      {art?.familyTips[f.family.id] ? (
        <SpellTip tip={art.familyTips[f.family.id]} size={20}>
          <span tabIndex={0} className="text-fg">{f.family.label}</span>
        </SpellTip>
      ) : (
        <span className="text-fg">
          {art?.families[f.family.id] && <GameIcon src={art.families[f.family.id]!} size={20} className="mr-2" />}
          {f.family.label}
        </span>
      )}
      <span className="block text-xs text-muted">{reach(f, table)}</span>
    </span>
  );
  const stateCell = (s: State) => <span className={`font-medium ${STATE_TEXT[s]}`}>{STATE_SHORT[s]}</span>;
  const buffColumns: Column<FamilyCoverage>[] = [
    { key: "effect", header: "Effect", cell: effectCell },
    { key: "raid", header: "Raid", cell: (f) => stateCell(f.raid), nowrap: true },
    ...groups.map((_, g): Column<FamilyCoverage> => ({ key: `g${g}`, header: `G${g + 1}`, cell: (f) => stateCell(f.groups[g]), nowrap: true })),
  ];
  const debuffColumns = buffColumns.slice(0, 2);

  // Missing for at least one group; a party buff some groups do have names the groups without it.
  const missing = [...cov.buffs, ...cov.debuffs].filter((f) => f.raid === "missing").map((f) => {
    const lacking = f.groups.flatMap((s, g) => (s === "missing" ? [`G${g + 1}`] : []));
    return { id: f.family.id, label: lacking.length < f.groups.length ? `${f.family.label} · ${lacking.join(" ")}` : f.family.label };
  });
  const debuffsCovered = cov.debuffs.filter((f) => f.raid === "covered").length;

  const dragClass = drag ? (drag.source.kind === "class" ? drag.source.class : slots[drag.source.index]?.class ?? null) : null;
  const overSlot = drag?.over?.kind === "slot" ? drag.over.index : null;
  const overTrash = drag?.source.kind === "slot" && drag.over?.kind === "trash";
  const draggable = "select-none [-webkit-touch-callout:none]";
  const compact = "min-h-10 px-3 text-sm";

  return (
    <div className="space-y-8">
      {classContext && <ClassContextChipFromAddress className="-mt-2" fragment={fragment} />}
      {linkBuild && (
        <p role="status" className="text-sm text-warning">
          This link was made for build <span className="font-mono">{linkBuild}</span>. This page has rules for build{" "}
          <span className="font-mono">{table.build}</span> only, so coverage uses those.
        </p>
      )}

      <section ref={layoutRef} aria-labelledby="raid-layout" className="space-y-3">
        <h2 id="raid-layout" className="sr-only">Raid</h2>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Segmented
            label="Raid size"
            value={size}
            onChange={(s) => {
              if (s === size) return;
              setSelected(null);
              commit({ size: s, slots: resize(slots, s) });
            }}
            options={SIZES.map((s) => ({ value: s, label: <>{s}<span className="sr-only"> players</span></> }))}
          />
          <p data-raid-summary className="text-meta text-fg-2">
            <span className="font-medium text-fg">{ros.filled} of {size}</span> filled
            {ros.filled > 0 && <><span aria-hidden="true"> · </span>{roles}</>}
          </p>
          <div role="toolbar" aria-label="Raid controls" className="flex flex-wrap gap-2 sm:ml-auto">
            <button type="button" className={`btn ${compact}`} onClick={undo} disabled={past.length === 0}>Undo</button>
            <button
              type="button"
              className={`btn ${compact}`}
              disabled={empty}
              onClick={() => { setSelected(null); commit({ size, slots: emptySlots(size) }); }}
            >
              Clear
            </button>
            <CopyButton className={`btn btn-primary ${compact}`} text={link} label="Copy link" onResult={onCopied} />
          </div>
        </div>

        <div className="space-y-1.5">
          <div role="group" aria-label="Classes" data-raid-palette className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-10">
            {CLASSES.map((c) => {
              const n = ros.classes[c];
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={armed === c}
                  aria-label={`${titleCase(c)}, ${n} in the raid`}
                  onPointerDown={startDrag({ kind: "class", class: c })}
                  onDragStart={(e) => e.preventDefault()}
                  onClick={() => pickClass(c)}
                  className={`flex h-9 min-w-0 cursor-grab items-center gap-1.5 rounded-control border border-l-4 bg-canvas px-2 text-left text-control font-medium transition-colors ${draggable} ${CLASS_TEXT[c]} ${CLASS_BORDER[c]} ${
                    armed === c ? "border-accent" : "border-edge hover:border-fg-2"
                  }`}
                >
                  {classIcon(c, 20, "")}
                  <span className="min-w-0 truncate">{titleCase(c)}</span>
                  {n > 0 && <span aria-hidden="true" className="ml-auto font-mono text-cell-2 text-fg-2">{n}</span>}
                </button>
              );
            })}
            <div
              data-drop-trash
              className={`flex h-9 items-center justify-center rounded-control border border-dashed px-2 text-cell-2 transition-colors ${
                overTrash ? "border-danger text-danger" : "border-edge text-muted"
              }`}
            >
              Drop to remove
            </div>
          </div>
          <p className="text-cell-2 text-muted">
            {armed ? (
              <>
                Placing <span className={`font-medium ${CLASS_TEXT[armed]}`}>{titleCase(armed)}</span>: pick a slot.{" "}
                <button type="button" className="text-fg-2 underline underline-offset-2 hover:text-fg" onClick={() => { setArmed(null); setMessage("Stopped placing."); }}>
                  Stop
                </button>
              </>
            ) : (
              "Drag a class into a slot, or pick a class and then a slot. Pick a filled slot to set its tree."
            )}
          </p>
        </div>

        <p role="status" aria-live="polite" className="min-h-5 text-meta text-fg-2">{message}</p>

        <div data-raid-groups className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {groups.map((group, g) => (
            <div key={g} role="group" aria-label={`Group ${g + 1}`} className="min-w-0">
              <Card padding="none" className="p-2">
                <h3 className="mb-1.5 px-1 text-th text-muted">Group {g + 1}</h3>
                <ul className="space-y-1">
                  {group.map((slot, k) => {
                    const index = g * GROUP_SIZE + k;
                    const treeName = slot && slot.tree ? treeNames(table, slot.class)[slot.tree - 1] : "any tree";
                    const source = drag?.source.kind === "slot" && drag.source.index === index;
                    const over = overSlot === index && !source;
                    return (
                      <li key={k}>
                        <button
                          type="button"
                          data-drop-slot={index}
                          ref={(el) => { slotRefs.current[index] = el; }}
                          aria-pressed={selected === index}
                          aria-label={`Group ${g + 1}, slot ${k + 1}: ${slot ? `${titleCase(slot.class)}, ${treeName}` : "empty"}`}
                          onClick={() => pickSlot(index)}
                          onPointerDown={slot ? startDrag({ kind: "slot", index }) : undefined}
                          onDragStart={(e) => e.preventDefault()}
                          className={`flex h-9 w-full min-w-0 items-center gap-2 rounded-control border px-2 text-left transition-colors ${draggable} ${
                            slot
                              ? `border-l-4 bg-canvas ${CLASS_BORDER[slot.class]} cursor-grab ${selected === index ? "border-accent" : "border-edge hover:border-fg-2"}`
                              : `border-dashed ${selected === index ? "border-accent" : "border-edge hover:border-fg-2"}`
                          } ${over ? "!border-accent bg-panel ring-1 ring-accent" : ""} ${source ? "!border-accent border-dashed" : ""}`}
                        >
                          {slot ? (
                            <>
                              {classIcon(slot.class, 20, "")}
                              <span className="min-w-0 truncate text-cell">
                                <span className={`font-medium ${CLASS_TEXT[slot.class]}`}>{titleCase(slot.class)}</span>{" "}
                                <span className="text-cell-2 text-fg-2">{treeName}</span>
                              </span>
                            </>
                          ) : (
                            <span className="text-cell-2 text-muted"><span aria-hidden="true">+ </span>Add</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </div>
          ))}
        </div>

        {drag && dragClass && (
          <div
            ref={ghostRef}
            aria-hidden="true"
            data-drag-ghost
            className={`pointer-events-none fixed left-0 top-0 z-50 flex h-9 items-center gap-1.5 rounded-control border border-l-4 border-accent bg-panel px-2 text-control font-medium ${CLASS_TEXT[dragClass]} ${CLASS_BORDER[dragClass]}`}
            style={{ transform: `translate(${ghostAt.current.x + 12}px, ${ghostAt.current.y + 12}px)` }}
          >
            {classIcon(dragClass, 20, "")}
            {titleCase(dragClass)}
          </div>
        )}

        {selected !== null && (
          <div
            ref={pickerRef}
            tabIndex={-1}
            role="group"
            aria-label={`Pick for group ${Math.floor(selected / GROUP_SIZE) + 1}, slot ${(selected % GROUP_SIZE) + 1}`}
            className="space-y-3 rounded-card border border-accent bg-panel p-3"
            onKeyDown={(e) => { if (e.key === "Escape") closePicker(); }}
          >
            <h3 className="text-h2-sm text-fg">
              Group {Math.floor(selected / GROUP_SIZE) + 1}, slot {(selected % GROUP_SIZE) + 1}
            </h3>
            <div role="group" aria-label="Class" className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
              {CLASSES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={current?.class === c}
                  className={`flex min-h-10 items-center gap-2 rounded-control border border-l-4 bg-canvas px-3 text-left font-medium transition-colors ${CLASS_TEXT[c]} ${CLASS_BORDER[c]} ${
                    current?.class === c ? "border-accent" : "border-edge hover:border-fg-2"
                  }`}
                  onClick={() => setSlot(selected, { class: c, tree: current?.class === c ? current.tree : 0 })}
                >
                  {classIcon(c, 24, "")}
                  {titleCase(c)}
                </button>
              ))}
            </div>
            <div role="group" aria-label="Talent tree" className="flex flex-wrap gap-1.5">
              {([0, 1, 2, 3] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={!current}
                  aria-pressed={!!current && current.tree === t}
                  className={`flex min-h-10 items-center gap-2 rounded-control border px-3 disabled:opacity-50 ${current ? CLASS_TEXT[current.class] : "text-fg"} ${
                    current && current.tree === t ? "border-accent" : "border-edge"
                  }`}
                  onClick={() => current && setSlot(selected, { class: current.class, tree: t })}
                >
                  {current && treeIcon(current.class, t, 24, "")}
                  {t === 0 || !current ? (t === 0 ? "Any tree" : `Tree ${t}`) : treeNames(table, current.class)[t - 1]}
                </button>
              ))}
            </div>
            {current && (
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="raid-move" className="text-sm text-fg-2">Move to</label>
                <select
                  id="raid-move"
                  value={moveTo}
                  onChange={(e) => setMoveTo(e.target.value)}
                  className="min-h-10 rounded-control border border-edge bg-canvas px-3 text-sm text-fg"
                >
                  <option value="">Choose a slot</option>
                  {slots.map((s, i) => i === selected ? null : (
                    <option key={i} value={i}>{`Group ${Math.floor(i / GROUP_SIZE) + 1}, slot ${(i % GROUP_SIZE) + 1}: ${describe(s)}`}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className={`btn ${compact}`}
                  disabled={moveTo === ""}
                  onClick={() => {
                    const to = Number(moveTo);
                    setMoveTo("");
                    if (moveMember(selected, to, true)) setSelected(to);
                  }}
                >
                  Move
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <button type="button" className={`btn ${compact}`} disabled={!current} onClick={() => setSlot(selected, null)}>Clear slot</button>
              <button type="button" className={`btn ${compact}`} onClick={closePicker}>Done</button>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="raid-coverage" className="space-y-3">
        <SectionHeading
          id="raid-coverage"
          note={
            <span role="status" aria-live="polite">
              Buffs for the whole raid: {cov.summary.covered} of {cov.buffs.length} yes, {cov.summary.cast} by cast,{" "}
              {cov.summary.possible} if talented, {cov.summary.unknown} unknown reach, {cov.summary.missing} missing.
              Debuffs: {debuffsCovered} of {cov.debuffs.length}.
            </span>
          }
        >
          Coverage
        </SectionHeading>
        {ros.filled === 0 ? (
          <p className="text-meta text-muted">Add classes to see what the raid is missing.</p>
        ) : missing.length === 0 ? (
          <p className="text-meta text-fg-2">Nothing missing.</p>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
            <h3 id="raid-missing" className="text-meta font-medium text-fg">Missing ({missing.length})</h3>
            <ul aria-labelledby="raid-missing" data-raid-missing className="flex flex-wrap items-center gap-1.5">
              {missing.slice(0, MISSING_SHOWN).map((m) => <li key={m.id}><Badge tone="neutral">{m.label}</Badge></li>)}
            </ul>
            {missing.length > MISSING_SHOWN && <span className="text-meta text-muted">and {missing.length - MISSING_SHOWN} more in the full coverage</span>}
          </div>
        )}
        <details data-coverage-details className="group border-t border-line">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 py-2 text-control font-medium text-fg-2 hover:text-fg [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="font-mono text-muted transition-transform group-open:rotate-45">+</span>
            Show full coverage
          </summary>
          <div className="space-y-4 pt-2">
            <DataTable caption="Buffs, per group" columns={buffColumns} rows={cov.buffs} rowKey={(f) => f.family.id} />
            <DataTable caption="Debuffs on the enemy" columns={debuffColumns} rows={cov.debuffs} rowKey={(f) => f.family.id} />
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              {(Object.keys(STATE_LABEL) as State[]).map((s) => (
                <div key={s} className="contents">
                  <dt className={`font-medium ${STATE_TEXT[s]}`}>{STATE_SHORT[s]}</dt>
                  <dd className="text-fg-2">{LEGEND[s]}</dd>
                </div>
              ))}
            </dl>
          </div>
        </details>
      </section>

      <section aria-labelledby="raid-share" className="space-y-2">
        <SectionHeading id="raid-share" note="Anyone with the link sees the same raid.">Share</SectionHeading>
        <div className="flex flex-wrap items-center gap-3 rounded-control border border-line bg-canvas p-3">
          <CopyButton className={`btn shrink-0 ${compact}`} text={code} label="Copy for addon" disabled={!slots.some(Boolean)}
            onResult={(ok) => setMessage(ok ? "Raid code copied. Open /everloot, choose the Raid tab, then Import." : "Copy failed. Copy the share link instead; the addon accepts it too.")} />
          <p className="text-sm text-fg-2">In the addon: <code>/everloot</code> → Raid tab → paste → Import. Compare classes by group; arrange players yourself.</p>
        </div>
        <div className="grid gap-2 lg:grid-cols-2">
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="raid-link">Share link</label>
            <Input id="raid-link" mono readOnly value={link} className="min-h-10 py-1.5 text-sm" />
            <CopyButton className={`btn shrink-0 ${compact}`} text={link} label="Copy" onResult={onCopied} />
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); load(paste, true); }}
          >
            <label className="sr-only" htmlFor="raid-paste">Raid code or link</label>
            <Input
              id="raid-paste"
              mono
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="Paste a raid code or link"
              className="min-h-10 py-1.5 text-sm"
            />
            <button type="submit" className={`btn shrink-0 ${compact}`} disabled={!paste.trim()}>Load</button>
          </form>
        </div>
      </section>
    </div>
  );
}

const LEGEND: Record<State, string> = {
  covered: "A class you picked brings it, and it reaches this group.",
  possible: "A class you picked brings it with a talent in one tree, and the only slots of that class are set to any tree.",
  cast: "A class you picked brings it, but it is cast on one player or a few nearby, so someone has to cast it.",
  unknown: "A class you picked brings it, but the game files do not settle how far it reaches, its ranks disagree, or the tree that gives it is not clear.",
  missing: "No class you picked brings it.",
};
