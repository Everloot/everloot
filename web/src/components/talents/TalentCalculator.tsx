"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { importPlan, planHash, readPlanHash, replacePlanHash, type ImportReport, type PlanImport } from "@/lib/talents/import";
import {
  addPoint, canMovePoint, emptySet, movedLater, movePoint, orderRefusalText, prefixRanks, removePoint, resetTree, type MovedPoint,
} from "@/lib/talents/order";
import {
  canAdd, canRemove, commit, entryAtRank, isLegal, nodeMap, pointsAtLevel, pointsByTree, pointsSpent, redo, refusalText,
  startHistory, undo, levelFor, type History,
} from "@/lib/talents/rules";
import { hasNodeFrames, loadGameAssets, type GameAssets } from "@/lib/talents/assets";
import { HOW_IT_WORKS_ID } from "@/lib/talents/facts";
import { encodeBuild, encodeOrder } from "@/lib/talents/share";
import { track } from "@/lib/analytics/track";
import { absoluteUrl } from "@/lib/seo";
import { DATA_SIZE } from "@/design/tokens";
import { buildTitle, previewPath, summarizeBuild } from "@/lib/talents/summary";
import type { PlanSet, Ranks, TalentCatalog } from "@/lib/talents/types";
import GameIcon from "@/components/game/GameIcon";
import { Card, CopyButton, Input, Segmented } from "@/components/ui";
import GameTree from "./GameTree";
import LevelingOrder, { forSet, pointName } from "./LevelingOrder";
import SaveBuild, { restorePendingSave } from "./SaveBuild";
import TalentTooltip, { type TipContent } from "./TalentTooltip";
import TalentTreeView, { assetOf, CLASS_TEXT, type TipMode } from "./TalentTreeView";

// Client side of the calculator: the point rules live in lib/talents/rules.ts and the spend order's in
// lib/talents/order.ts; this file only holds state and wires clicks, long presses and keys to them.

type Sets = [PlanSet, PlanSet];
const LONG_PRESS_MS = 500;

/** Every node at the same rank in both: the code's points all placed as it asked (a corrected choice aside). */
const samePoints = (a: Ranks, b: Ranks) =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([id, r]) => b[Number(id)]?.rank === r.rank);

/** The order with the point at `from` put at `to`: the order a refused move tried. */
const reordered = (order: number[], from: number, to: number) => {
  const next = [...order];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
};

/** " 3 points changed places …" after a take-back or tree reset that reordered points; nothing when none moved. */
const movedNote = (moved: MovedPoint[]) =>
  moved.length === 0 ? "" : ` ${moved.length} ${moved.length === 1 ? "point" : "points"} changed places to keep the spend order legal: Spend order below says where each went.`;

/**
 * `treeIcons` are the trees' icons in the catalog's tree order, from the site's asset folder; absent without one.
 * `classIcon` is the game's class icon for the build bar, from the same folder.
 * `initialCodes` are the two sets' share codes from a build link (/b/...), opened when the address has no #plan=.
 * `savedBuilds` shows Save and My builds (EVERLOOT_SAVED_BUILDS). `readOnly` shows `initialCodes` without
 * letting points change and leaves the address alone, for a saved build's short link (/b/<slug>).
 */
export default function TalentCalculator({ catalog, treeIcons, classIcon = null, initialCodes, savedBuilds = false, readOnly = false }: {
  catalog: TalentCatalog; treeIcons?: (string | null)[]; classIcon?: string | null; initialCodes?: (string | null)[]; savedBuilds?: boolean; readOnly?: boolean;
}) {
  const { rules } = catalog;
  const [history, setHistory] = useState<History<Sets>>(() => startHistory<Sets>([emptySet(), emptySet()]));
  // A set opened with an order token this page cannot use (a newer version's, say), its points placed as the code
  // asked, keeps the token as it came in the address and the links until the set changes: an edit makes a new set,
  // and undo brings this one back with its token.
  const [came] = useState(() => new WeakMap<PlanSet, string>());
  /** The points the last take-back or tree reset moved, shown while that set is on screen as it left it. */
  const [moves, setMoves] = useState<{ after: PlanSet; points: MovedPoint[] } | null>(null);
  /** The spend order's preview: the trees show the set after its first `points` points, while that set is on screen. */
  const [preview, setPreview] = useState<{ set: PlanSet; points: number } | null>(null);
  /** The last move the order refused: the point's place and why, said again under its row while that set is on screen. */
  const [refused, setRefused] = useState<{ set: PlanSet; at: number; text: string } | null>(null);
  const [active, setActive] = useState<0 | 1>(0);
  const [level, setLevel] = useState(rules.maxLevel);
  const [planAhead, setPlanAhead] = useState(false);
  const [view, setView] = useState(0);
  const [removeMode, setRemoveMode] = useState(false);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [rovingByTree, setRovingByTree] = useState<Record<number, number>>({});
  const [link, setLink] = useState("");
  const [pasted, setPasted] = useState("");
  const [report, setReport] = useState<(ImportReport & { loaded: boolean }) | null>(null);
  const [assets, setAssets] = useState<GameAssets | null>(null);
  const [tip, setTip] = useState<{ id: number; mode: TipMode } | null>(null);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  const countedBuild = useRef(false);
  /** The address fragment the page last wrote for the build on screen. */
  const written = useRef<string | null>(null);

  // The game's icons, tooltips and frame art, when the site has an asset folder. Anything wrong with
  // it leaves assets null and the page as it was.
  useEffect(() => {
    let live = true;
    void loadGameAssets().then((a) => { if (live) setAssets(a); });
    return () => { live = false; };
  }, []);
  const game = assets !== null && hasNodeFrames(assets);

  function onTip(id: number | null, mode: TipMode) {
    setTip((cur) => (id === null ? (cur?.mode === mode ? null : cur) : { id, mode }));
  }

  const set = history.present[active];
  const { ranks } = set;
  const available = pointsAtLevel(catalog, level);
  const spent = pointsSpent(ranks);
  const perTree = pointsByTree(catalog, ranks);
  const secondOpen = level >= rules.dualSpecLevel || planAhead;
  const nodes = nodeMap(catalog);
  const nameOf = (id: number) => {
    const n = nodes.get(id);
    return n ? (n.kind === "choice" ? n.entries.map((e) => e.name).join(" or ") : n.entries[0].name) : "";
  };
  // The levels this set's points come at: the second set's wait for the level it opens at.
  const schedule = useMemo(() => forSet(catalog, active), [catalog, active]);

  // While the preview is on, the trees show the set as it stood after that many points of its order, at the level the
  // last of them came: the ranks then, the points the character had then, and that last point's talent marked. The
  // build bar keeps the whole set. A preview belongs to the set it was opened on and ends when another is on screen.
  const previewing = preview?.set === set ? preview.points : null;
  const prefix = previewing === null ? null : prefixRanks(set, previewing);
  const shownRanks = prefix ?? ranks;
  const shownAvailable = previewing === null ? available : pointsAtLevel(schedule, levelFor(schedule, previewing));
  const shownPerTree = prefix ? pointsByTree(catalog, prefix) : perTree;
  const highlighted = previewing === null ? null : set.order?.[previewing - 1] ?? null;
  // A preview and a refused move's note belong to the set on screen: another set, an edit or an opened link ends both,
  // and Undo back to that set does not bring them back.
  useEffect(() => {
    setPreview(null);
    setRefused(null);
  }, [set]);
  /** The preview as the page last showed it, for a long press's timer, which runs from the render the press began in. */
  const previewNow = useRef<number | null>(null);
  useEffect(() => { previewNow.current = previewing; }, [previewing]);

  function setSets(next: Sets) {
    if (readOnly) return;
    setHistory((h) => commit(h, next));
  }
  const READ_ONLY = "This is a saved build. Open it in the calculator to change it.";
  // Read only while the preview is on: every edit is refused, and says how to get back to changing points.
  function previewOnly() {
    if (previewing === null) return false;
    setMessage("This is a preview. Turn it off to change points.");
    return true;
  }
  function setActiveSet(next: PlanSet) {
    const sets: Sets = [...history.present];
    sets[active] = next;
    setSets(sets);
  }

  /** The set an import made, and the order token it came with when this page could not use it but it still fits. */
  function opened(result: Extract<PlanImport, { ok: true }>): PlanSet {
    if (!result.set.order && result.token && samePoints(result.requested, result.set.ranks)) came.set(result.set, result.token);
    return result.set;
  }

  // A failed import changes nothing: the sets, their orders and the undo steps stay as they were. A broken order's line
  // names the levels of the set it goes into.
  function load(text: string) {
    if (previewOnly()) return;
    const result = importPlan(catalog, text, undefined, schedule);
    if (!result.ok) {
      setReport(null);
      setMessage(result.message);
      return;
    }
    const sets: Sets = [...history.present];
    sets[active] = opened(result);
    setHistory((h) => commit(h, sets));
    setLevel((current) => Math.min(rules.maxLevel, Math.max(current, result.minLevel)));
    setReport({ ...result.report, loaded: true });
    setMessage(result.report.problems.length === 0 ? "Build loaded." : "Build loaded with changes. The list below says what.");
  }

  // A share link carries its code after #plan=. The hash never reaches the server, so the page itself
  // stays static and cached. Read when the page opens and whenever the hash changes, so pasting a
  // link into a tab that is already open loads it.
  useEffect(() => {
    function fromHash(opening: boolean, codes = readPlanHash(window.location.hash)) {
      // The first set rides after #plan= (the code the addon reads), the second after &plan2=, and each set's
      // spend order after &order= and &order2=. A link from before orders opens with the orders unknown.
      if (!codes.first && !codes.second) return;
      const results = ([[codes.first, codes.firstOrder, 0], [codes.second, codes.secondOrder, 1]] as const)
        .map(([c, token, slot]) => (c ? importPlan(catalog, c, token ?? null, forSet(catalog, slot)) : null));
      for (const r of results) if (r && !r.ok) { setMessage(r.message); return; }
      const [one, two] = results as (Extract<PlanImport, { ok: true }> | null)[];
      const loaded = [one, two].filter((r) => r !== null);
      const sets = [one && opened(one), two && opened(two)];
      setHistory((h) => (opening
        ? startHistory<Sets>([sets[0] ?? emptySet(), sets[1] ?? emptySet()])
        : commit(h, [sets[0] ?? h.present[0], sets[1] ?? h.present[1]])));
      setActive(one ? 0 : 1);
      const minLevel = Math.max(...loaded.map((r) => r.minLevel), two ? rules.dualSpecLevel : 0);
      setLevel((current) => Math.min(rules.maxLevel, Math.max(opening ? rules.maxLevel : current, minLevel)));
      const problems = loaded.flatMap((r) => r.report.problems);
      setReport({ ...loaded[0].report, problems, loaded: true });
      setMessage(problems.length === 0 ? `${loaded.length === 2 ? "Both sets" : "Build"} loaded from the link.` : "Loaded from the link with changes. The list below says what.");
    }
    // A saved build's short link shows its codes as they are and keeps its own address.
    if (readOnly) {
      fromHash(true, { first: initialCodes?.[0] ?? null, second: initialCodes?.[1] ?? null });
      return;
    }
    // Back from signing in to save: the build waited in session storage while the visitor was away.
    if (savedBuilds) restorePendingSave();
    // A build link carries its codes in the path, and their spend orders after #order= and &order2=; move them into
    // the class page's #plan= address, which is what the page keeps up to date from here on, and read them from
    // there. Anything else in the fragment, such as a cookie choice, comes along.
    const sent = readPlanHash(window.location.hash);
    if (!sent.first && !sent.second && initialCodes?.some(Boolean)) {
      const plan = planHash(initialCodes[0] ?? null, initialCodes[1] ?? null, sent.firstOrder, sent.secondOrder);
      window.history.replaceState(window.history.state, "", `/tools/talents/${catalog.classSlug}${replacePlanHash(window.location.hash, plan)}`);
    }
    fromHash(true);
    // The page rewrites its own address as points are spent; only a hash it did not write is a new link.
    const onHashChange = () => { if (window.location.hash !== written.current) fromHash(false); };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
    // initialCodes come from the server once per page; reading them again on a change is not wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, rules.maxLevel, rules.dualSpecLevel]);

  // Undo and redo can bring back more points than the level now holds (spend 8, undo 3, lower the
  // level, redo 3). Raise the level to fit rather than show more points spent than allowed.
  function travel(step: (h: History<Sets>) => History<Sets>) {
    if (readOnly || previewOnly()) return;
    const next = step(history);
    if (next === history) return;
    const needed = Math.max(...next.present.map((s) => levelFor(catalog, pointsSpent(s.ranks))));
    setHistory(next);
    if (needed > level) {
      setLevel(needed);
      setMessage(`Level raised to ${needed}, the lowest that holds the points in this build.`);
    }
  }

  function doAdd(id: number, choice?: number) {
    if (readOnly) { setMessage(READ_ONLY); return; }
    if (previewOnly()) return;
    const node = nodes.get(id)!;
    // The point joins the end of the set's order.
    const next = addPoint(catalog, set, id, available, choice);
    if (next === set) {
      const verdict = canAdd(catalog, ranks, id, available);
      setMessage(verdict.ok ? "" : refusalText(verdict.reason!, node, catalog, ranks));
      return;
    }
    setActiveSet(next);
    if (!countedBuild.current) {
      countedBuild.current = true;
      track("talent_build_made", { class: catalog.classSlug });
    }
    const now = next.ranks[id]?.rank ?? 0;
    setMessage(`${nameOf(id)}: rank ${now} of ${node.maxRanks}.`);
  }

  // A point taken back leaves the order; a later one that could no longer be taken where it stands waits for the
  // points it needs, and the page says where each moved point went. When what stays could not be spent in any
  // legal order, the point stays and the page says why.
  function doRemove(id: number) {
    if (readOnly) { setMessage(READ_ONLY); return; }
    if (previewOnly()) return;
    const node = nodes.get(id)!;
    const next = removePoint(catalog, set, id);
    if (next === set) {
      const verdict = canRemove(catalog, ranks, id);
      setMessage(verdict.ok
        ? `${nameOf(id)} stays: the points after it could not be spent in a legal order without it. Take back a later point first.`
        : refusalText(verdict.reason!, node, catalog, ranks));
      return;
    }
    setActiveSet(next);
    const moved = movedLater(schedule, set, next);
    setMoves({ after: next, points: moved });
    setMessage(`${nameOf(id)}: rank ${next.ranks[id]?.rank ?? 0} of ${node.maxRanks}.${movedNote(moved)}`);
  }

  // A point of the spend order moves one place earlier or later, through the order engine. A move that would take a
  // point before the rules allow it is refused with the engine's own reason: the talent, the level and what it needs.
  function doMove(from: number, to: number) {
    if (previewOnly() || !set.order) return;
    const order = set.order;
    const id = order[from];
    const what = pointName(nodes.get(id)!, ranks, order.slice(0, from + 1).filter((n) => n === id).length);
    const next = movePoint(catalog, set, from, to);
    if (next !== set) {
      setActiveSet(next);
      setMessage(`${what} is now point ${to + 1}, at level ${levelFor(schedule, to + 1)}.`);
      return;
    }
    const verdict = canMovePoint(catalog, set, from, to);
    const text = verdict && !verdict.ok ? `${what} stays at point ${from + 1}. ${orderRefusalText(schedule, ranks, reordered(order, from, to), verdict)}`
      : to < 0 ? `${what} is already the first point.`
      : to >= order.length ? `${what} is already the last point.`
      : `${what} stays at point ${from + 1}: the point ${to < from ? "before" : "after"} it is on the same talent.`;
    setMessage(text);
    setRefused({ set, at: from, text });
  }

  // The preview changes only what the trees show, never the set. A phone shows the tree its point went to. A long press
  // under way is cancelled, so it cannot take a point back once the preview is on.
  function showPreview(points: number | null) {
    endPress();
    setPreview(points === null ? null : { set, points });
    const tree = points === null ? undefined : nodes.get(set.order?.[points - 1] ?? -1)?.treeId;
    if (tree !== undefined) setView(catalog.trees.findIndex((t) => t.id === tree));
  }

  function setLevelClamped(value: number) {
    const needed = Math.max(...history.present.map((s) => levelFor(catalog, pointsSpent(s.ranks))));
    const next = Math.max(rules.firstPointLevel, Math.min(rules.maxLevel, value));
    if (next < needed) {
      setLevel(needed);
      setMessage(`Level ${needed} is the lowest that holds the points already spent. Remove points first.`);
      return;
    }
    setLevel(next);
    if (next < rules.dualSpecLevel && !planAhead && active === 1) setActive(0);
  }

  function chooseSet(slot: 0 | 1) {
    if (slot === 1 && !secondOpen) return;
    setActive(slot);
  }

  // The page address is the build, as old talent calculators did it: every point spent rewrites the
  // fragment, so copying the address bar shares both sets and their orders. Skipped on the first run,
  // where the build from an opened link has not loaded yet and would be wiped. Only the plan's own parts
  // are rewritten; anything else there (a cookie choice) stays.
  const linkReady = useRef(false);
  const codes = useMemo<[string | null, string | null]>(() => {
    const codeOf = (r: Ranks) => (pointsSpent(r) > 0 ? encodeBuild({ classSlug: catalog.classSlug, specId: catalog.specId, build: catalog.build, ranks: r }) : null);
    return [codeOf(history.present[0].ranks), codeOf(history.present[1].ranks)];
  }, [history.present, catalog]);
  // Each set's spend order token: its own known order, or the token it came with, unchanged; null when unknown.
  const orders = useMemo<[string | null, string | null]>(() => {
    const tokenOf = (s: PlanSet) => (s.order && s.orderOrigin ? encodeOrder(s.ranks, s.order, s.orderOrigin) : came.get(s) ?? null);
    return [tokenOf(history.present[0]), tokenOf(history.present[1])];
  }, [history.present, came]);
  useEffect(() => {
    if (readOnly) return;
    if (!linkReady.current) { linkReady.current = true; return; }
    const [first, second] = codes;
    const hash = replacePlanHash(window.location.hash, planHash(first, second, orders[0], orders[1]));
    const { pathname, search, origin } = window.location;
    written.current = hash;
    if (window.location.hash !== hash) window.history.replaceState(window.history.state, "", `${pathname}${search}${hash}`);
    // The link handed out is the build link: same build, and its preview in a chat names it. Its codes are in the
    // path, so their orders ride in its fragment, which the class page reads when the link opens.
    const preview = previewPath(catalog.classSlug, first, second);
    const sequence = [first && orders[0] && `order=${encodeURIComponent(orders[0])}`, second && orders[1] && `order2=${encodeURIComponent(orders[1])}`].filter(Boolean).join("&");
    setLink(preview ? `${origin}${preview}${sequence ? `#${sequence}` : ""}` : "");
  }, [codes, orders, catalog, readOnly]);

  // Copy for addon: one set, as the full class page link with that set's own pair, set 2's under plan2= and order2=.
  const addonLink = codes[active]
    ? absoluteUrl(`/tools/talents/${catalog.classSlug}${active === 0 ? planHash(codes[0], null, orders[0]) : planHash(null, codes[1], null, orders[1])}`)
    : "";

  const onCopied = (ok: boolean) => {
    setMessage(ok ? "Link copied. It opens both sets as they are now." : "Copy failed. Select the link and copy it.");
    if (ok) track("talent_build_shared", { via: "copy" });
  };

  // Taps add. A long press (touch or pen) takes a point back, as does a right click, the Delete or
  // Backspace key, and the "Take points back" switch. With the game's tooltips on the page, a long
  // press shows the tooltip instead (a phone has no hover), and the switch is how a phone takes
  // points back.
  function nodeIdOf(target: EventTarget): number | null {
    const el = (target as HTMLElement).closest?.("[data-node]");
    return el ? Number(el.getAttribute("data-node")) : null;
  }
  function onPointerDown(e: PointerEvent<HTMLElement>) {
    suppressClick.current = false;
    const id = nodeIdOf(e.target);
    if (id === null) { setTip((cur) => (cur?.mode === "press" ? null : cur)); return; }
    if (e.pointerType === "mouse") return;
    endPress();
    press.current = setTimeout(() => {
      suppressClick.current = true;
      if (assets) onTip(id, "press");
      // This runs half a second after the press, from the render it began in: only the ref knows whether the preview
      // has come on since.
      else if (previewNow.current === null) doRemove(id);
    }, LONG_PRESS_MS);
  }
  // Touch browsers also send a context menu event on a long press. Whichever arrives first takes
  // the point back; the other is ignored.
  function onContextMenu(e: React.MouseEvent<HTMLElement>) {
    const id = nodeIdOf(e.target);
    if (id === null) return;
    e.preventDefault();
    if (suppressClick.current) return;
    if (press.current) {
      endPress();
      suppressClick.current = true;
      if (assets) { onTip(id, "press"); return; }
    }
    doRemove(id);
  }
  function endPress() {
    if (press.current) clearTimeout(press.current);
    press.current = null;
  }
  function onClickCapture(e: React.MouseEvent<HTMLElement>) {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    const id = nodeIdOf(e.target);
    if (id !== null && removeMode) {
      e.stopPropagation();
      e.preventDefault();
      doRemove(id);
    }
  }
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    // Typing in the paste box keeps its own undo.
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === "Escape") setTip(null);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      travel(e.shiftKey ? redo : undo);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      travel(redo);
      return;
    }
    const id = nodeIdOf(e.target);
    if (id === null) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      doRemove(id);
      return;
    }
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const dir = arrows[e.key];
    if (!dir) return;
    e.preventDefault();
    const from = nodes.get(id)!;
    const peers = catalog.nodes.filter((n) => n.treeId === from.treeId && n.id !== id);
    let target;
    if (dir[0] === 0) {
      // Left and right stay on the row.
      target = peers
        .filter((n) => n.row === from.row && Math.sign(n.col - from.col) === dir[1])
        .sort((a, b) => Math.abs(a.col - from.col) - Math.abs(b.col - from.col))[0];
    } else {
      // Up and down stay in the column if they can; otherwise they go to the next row that has
      // anything, at the nearest column.
      const below = peers.filter((n) => Math.sign(n.row - from.row) === dir[0]);
      target = below
        .filter((n) => n.col === from.col)
        .sort((a, b) => Math.abs(a.row - from.row) - Math.abs(b.row - from.row))[0];
      if (!target && below.length > 0) {
        const nextRow = below.reduce((best, n) => (Math.abs(n.row - from.row) < Math.abs(best - from.row) ? n.row : best), below[0].row);
        target = below
          .filter((n) => n.row === nextRow)
          .sort((a, b) => Math.abs(a.col - from.col) - Math.abs(b.col - from.col))[0];
      }
    }
    if (!target) return;
    setRovingByTree((r) => ({ ...r, [from.treeId]: target.id }));
    document.getElementById(target.kind === "choice" ? `talent-${target.id}-0` : `talent-${target.id}`)?.focus();
  }

  const selectedNode = selected === null ? null : nodes.get(selected) ?? null;

  // The tooltip of the node under the pointer, focus or long press, as the trees show it.
  let tipContent: TipContent | null = null;
  let tipAnchor: string | null = null;
  const tipNode = tip ? nodes.get(tip.id) ?? null : null;
  if (assets && tipNode) {
    const rank = shownRanks[tipNode.id]?.rank ?? 0;
    const choice = tipNode.kind === "choice";
    const entries = choice ? tipNode.entries : [entryAtRank(tipNode, rank)];
    const verdict = canAdd(catalog, shownRanks, tipNode.id, shownAvailable);
    tipAnchor = choice ? `talent-${tipNode.id}-0` : `talent-${tipNode.id}`;
    tipContent = {
      title: entries.map((e) => e.name).join(" or "),
      rank: `Rank ${rank}/${tipNode.maxRanks}`,
      text: entries.map((e) => assetOf(assets, e)?.text).filter(Boolean).join("\n\n") || null,
      partial: entries.some((e) => assetOf(assets, e)?.partial),
      lock: verdict.ok || verdict.reason === "max-rank" ? null : refusalText(verdict.reason!, tipNode, catalog, shownRanks),
      label: `${assets.label} · build ${assets.version}`,
    };
  }
  const classText = CLASS_TEXT[catalog.classSlug];
  // The tree with the most points names the build, as players say it ("Fire 17/34/0"); none before the first point.
  const lead = summarizeBuild(catalog, ranks).lead;
  const rovingFor = (treeId: number) => rovingByTree[treeId] ?? catalog.nodes.find((n) => n.treeId === treeId)!.id;
  const setName = active === 0 ? "set 1" : "set 2";
  const left = Math.max(0, available - spent);

  // Take every point out of one tree. Refused when another tree's talents need those points, or when the points left
  // could not be spent in any legal order; either way the page says which.
  function onResetTree(treeId: number, name: string) {
    if (previewOnly()) return;
    const next = resetTree(catalog, set, treeId);
    if (next === set) {
      const left: Ranks = {};
      for (const [id, r] of Object.entries(ranks)) if (nodes.get(Number(id))?.treeId !== treeId) left[Number(id)] = r;
      setMessage(isLegal(catalog, left)
        ? `${name} was not reset: the points in the other trees could not be spent in a legal order without its points. Take back some of those first.`
        : `Talents in another tree need the points in ${name}. Take those back first.`);
      return;
    }
    setActiveSet(next);
    const moved = movedLater(schedule, set, next);
    setMoves({ after: next, points: moved });
    setMessage(`${name} was reset. Undo brings it back.${movedNote(moved)}`);
  }

  // The explanations live in the page's closed "How it works" section; "?" opens it and goes there.
  function openHowTo() {
    const how = document.getElementById(HOW_IT_WORKS_ID);
    if (how instanceof HTMLDetailsElement) how.open = true;
    how?.scrollIntoView({ block: "start" });
  }

  // A browser brings a talent that takes focus into the window, but leaves it where it is if it is already in it, even
  // under the site header, the phone's stuck tree switch or the cookie banner (which sets the strip it covers as the
  // page's bottom scroll padding while it is open). So a talent, or the phone's Reset after the talents, that takes
  // keyboard focus there moves to 8 px clear of them. Not one focused by a press: moving it then would put the release
  // on another control. The switch counts where it sticks, under the header: the end of the trees can push it up, and
  // it drops back there as soon as the page scrolls up. Where it does not stick, it scrolls with the trees above them.
  const treeSwitch = useRef<HTMLDivElement>(null);
  function keepClear(e: React.FocusEvent<HTMLElement>) {
    const bar = treeSwitch.current;
    const el = e.target as HTMLElement;
    if (!bar || !el.matches("[data-node], [data-tree-reset]") || !el.matches(":focus-visible")) return;
    const sticks = bar.getClientRects().length > 0 && getComputedStyle(bar).position === "sticky";
    const top = DATA_SIZE.header + (sticks ? bar.offsetHeight : 0) + 8;
    const bottom = window.innerHeight - (parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom) || 0);
    const box = el.getBoundingClientRect();
    if (box.top < top) window.scrollBy(0, box.top - top);
    else if (box.bottom > bottom) window.scrollBy(0, Math.min(box.bottom - bottom, box.top - top));
  }

  // The switch sticks only while it and the site header take a quarter of the window at most, so a talent with focus
  // keeps room under them. The media query on its class answers to the reader's text-size setting; this also answers to
  // a root font set by a page or a reader's style sheet, which a media query cannot see.
  const [switchSticks, setSwitchSticks] = useState(true);
  useEffect(() => {
    const bar = treeSwitch.current;
    if (!bar) return;
    const fit = () => setSwitchSticks(DATA_SIZE.header + bar.offsetHeight <= window.innerHeight / 4);
    fit();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    observer?.observe(bar);
    window.addEventListener("resize", fit);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  // A tree narrower than its talents scrolls sideways (three trees side by side on a tablet). The preview's talent and
  // its mark come into their own tree's view, 16 px inside its edge; the page itself does not move.
  const trees = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = trees.current?.querySelector<HTMLElement>("[data-highlighted]");
    const box = node?.closest<HTMLElement>("[data-tree-scroll]");
    if (!node || !box) return;
    const edge = box.getBoundingClientRect();
    const at = node.getBoundingClientRect();
    if (at.left < edge.left + 16) box.scrollLeft -= edge.left + 16 - at.left;
    else if (at.right > edge.right - 16) box.scrollLeft += at.right - (edge.right - 16);
  }, [highlighted]);

  return (
    // On a phone the set and tree switches are 44 px tall like the calculator's other buttons (the switch itself is 40).
    <div onKeyDown={onKeyDown} data-calculator className="max-md:[&_[data-segmented]_button]:min-h-11">
      {/* Clipped rather than hidden: a card with overflow hidden is a scroll container, and the phone's tree switch
          below could not stick to the window from inside it. Marked important so it wins over the card's own
          overflow-hidden whatever order the two utilities are written in. */}
      <Card padding="none" className="!overflow-clip">
        {/* The build at a glance: which tree leads, the split, points left, the level it needs, and the link. */}
        <section aria-label="Build" className="flex flex-wrap items-center gap-x-8 gap-y-2 border-b border-line px-4 py-2 md:gap-y-3 md:py-3">
          {/* A phone puts the link beside the build and the figures under them; a wide screen keeps them on one line. */}
          <div className="flex min-w-0 flex-1 items-center gap-3 lg:flex-none">
            {classIcon && <GameIcon src={classIcon} size={36} />}
            <p className="text-xl font-bold tracking-tight">
              <span className={classText}>{lead ?? catalog.className}</span>{" "}
              <span className="font-mono tabular-nums text-fg" aria-label={`Points by tree: ${catalog.trees.map((t) => `${t.name} ${perTree.get(t.id) ?? 0}`).join(", ")}`}>
                {catalog.trees.map((t) => perTree.get(t.id) ?? 0).join("/")}
              </span>
            </p>
          </div>
          <div className="order-last flex items-end gap-6 lg:order-none">
            <Stat label="Points left" value={left} />
            {/* The level the set's last point comes at, so set 2's is never below the level it opens at, as its order says.
                The level slider keeps its own meaning: the points a level gives. */}
            <Stat label="Level needed" value={spent === 0 ? "–" : levelFor(schedule, spent)} />
            <label className="flex flex-col gap-0.5">
              <span className="text-xs text-muted">Level</span>
              <span className="flex items-center gap-3">
                <span className="w-7 font-mono text-xl font-semibold tabular-nums text-fg">{level}</span>
                <input
                  type="range"
                  min={rules.firstPointLevel}
                  max={rules.maxLevel}
                  value={level}
                  aria-label="Character level"
                  aria-valuetext={`Level ${level}, ${available} talent points`}
                  onChange={(e) => setLevelClamped(Number(e.target.value))}
                  className="w-24 accent-[rgb(var(--accent))] sm:w-32"
                />
              </span>
            </label>
          </div>
          {!readOnly && <CopyButton className="btn btn-primary text-sm lg:ml-auto" text={link} label="Copy link" onResult={onCopied} disabled={!link} />}
          {/* Save, My builds and the save panel, which takes its own row under the bar. */}
          {savedBuilds && !readOnly && (
            <SaveBuild classSlug={catalog.classSlug} codes={codes} defaultName={buildTitle(catalog, summarizeBuild(catalog, history.present[0].ranks))} onMessage={setMessage} />
          )}
        </section>

        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 md:py-3">
          <Segmented
            label="Talent set"
            value={active}
            onChange={chooseSet}
            options={[{ value: 0, label: "Set 1" }, { value: 1, label: "Set 2", disabled: !secondOpen }]}
          />
          {!readOnly && (
            <>
              <button type="button" className="btn px-3 text-sm sm:px-5" onClick={() => travel(undo)} disabled={history.past.length === 0 || previewing !== null}>Undo</button>
              <button type="button" className="btn px-3 text-sm sm:px-5" onClick={() => travel(redo)} disabled={history.future.length === 0 || previewing !== null}>Redo</button>
              <button type="button" className="btn px-3 text-sm sm:px-5" onClick={() => { if (previewOnly()) return; setActiveSet(emptySet()); setMessage("This set was reset. Undo brings it back."); }} disabled={spent === 0 || previewing !== null}><span className="sm:hidden">Reset</span><span className="hidden sm:inline">Reset {setName}</span></button>
              <button type="button" className="btn px-3 text-sm sm:px-5" aria-pressed={removeMode} onClick={() => setRemoveMode(!removeMode)}>
                <span className="sm:hidden">Take back: {removeMode ? "on" : "off"}</span><span className="hidden sm:inline">Take points back: {removeMode ? "on" : "off"}</span>
              </button>
            </>
          )}
          <button type="button" className="btn size-11 !px-0 text-sm" aria-label="How the calculator works" title="How it works" onClick={openHowTo}>?</button>
          {level < rules.dualSpecLevel && (
            <label className="flex min-h-11 items-center gap-3 text-sm text-fg-2">
              <input type="checkbox" checked={planAhead} onChange={(e) => { setPlanAhead(e.target.checked); if (!e.target.checked && active === 1) setActive(0); }} className="size-5" />
              Plan set 2 now (it opens at level {rules.dualSpecLevel})
            </label>
          )}
          <p role="status" aria-live="polite" className="min-h-5 basis-full text-sm text-fg-2 lg:ml-auto lg:basis-auto">{message}</p>
        </div>

        {/* The trees. A phone shows one at a time, and its switch sticks under the site header while the tree scrolls,
            with what is left to spend and the set. Only in a window at least 37.5rem (600 px) tall, and while there is
            room for it (switchSticks): zoomed in further, the header, the switch and an open cookie banner would leave no
            room for a talent with focus. */}
        <div>
          <div ref={treeSwitch} className={`top-header z-10 border-b border-line bg-panel px-4 pb-2 pt-1 md:hidden ${switchSticks ? "[@media(min-height:37.5rem)]:sticky" : ""}`}>
            {/* A long tree name wraps inside its button, and a word too long for it is hyphenated, rather than running
                into the next one. */}
            <Segmented stretch label="Show tree" value={view} onChange={setView} options={catalog.trees.map((t, i) => ({ value: i, label: <span className="min-w-0 whitespace-normal text-center leading-tight [overflow-wrap:anywhere] hyphens-auto">{t.name} {shownPerTree.get(t.id) ?? 0}</span> }))} />
            {/* The status line already reads every change out; this copy is for the eye only. During a preview it says which
                point the trees show, since the preview's own controls are under the trees. */}
            <p aria-hidden="true" data-tree-status className="mt-1 text-xs text-fg-2">
              {previewing === null ? `${left} left · Set ${active + 1}` : `Set ${active + 1} preview · point ${previewing} of ${set.order?.length} · level ${levelFor(schedule, previewing)}`}
            </p>
          </div>

          <div ref={trees} className="grid gap-4 p-4 max-md:pt-2 md:grid-cols-3" onFocus={keepClear} onPointerDown={onPointerDown} onPointerUp={endPress} onPointerLeave={endPress} onPointerCancel={endPress} onClickCapture={onClickCapture} onContextMenu={onContextMenu}>
            {catalog.trees.map((tree, i) => {
              const points = shownPerTree.get(tree.id) ?? 0;
              return (
                <section key={tree.id} className={`min-w-0 ${i === view ? "" : "hidden md:block"}`} aria-label={tree.name}>
                  {/* On a phone the switch above carries the tree's name and points, and its Reset follows the talents; the
                      heading stays for screen readers. */}
                  <div className="mb-2 space-y-1.5 max-md:mb-0">
                    <div className="flex items-center gap-2">
                      {treeIcons?.[i] && <GameIcon src={treeIcons[i]!} size={24} className="max-md:hidden" />}
                      <h2 className={`min-w-0 truncate text-base font-semibold max-md:sr-only ${classText}`}>{tree.name}</h2>
                      <span className={`ml-auto font-mono text-xl tabular-nums max-md:hidden ${points === 0 ? "text-muted" : "text-fg"}`}>{points}</span>
                      {!readOnly && <button type="button" className="min-h-11 px-1 text-sm text-muted hover:text-fg disabled:opacity-50 max-md:hidden" disabled={points === 0 || previewing !== null} aria-label={`Reset ${tree.name}`} onClick={() => onResetTree(tree.id, tree.name)}>Reset</button>}
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-canvas max-md:hidden" aria-hidden="true">
                      <div className={`h-full rounded-full bg-current ${classText}`} style={{ width: `${shownAvailable ? Math.min(100, (points / shownAvailable) * 100) : 0}%` }} />
                    </div>
                  </div>
                  {(() => {
                    const props = {
                      catalog, tree, ranks: shownRanks, available: shownAvailable, spent: points, selected, roving: rovingFor(tree.id), highlighted,
                      onAdd: doAdd, onTip,
                      onSelect: (id: number) => { setSelected(id); setRovingByTree((r) => ({ ...r, [nodes.get(id)!.treeId]: id })); },
                    };
                    return game ? <GameTree {...props} assets={assets} /> : <TalentTreeView {...props} assets={assets} />;
                  })()}
                  {!readOnly && <button type="button" data-tree-reset className="mt-2 min-h-11 px-1 text-sm text-muted hover:text-fg disabled:opacity-50 md:hidden" disabled={points === 0 || previewing !== null} aria-label={`Reset ${tree.name}`} onClick={() => onResetTree(tree.id, tree.name)}>Reset {tree.name}</button>}
                </section>
              );
            })}
          </div>
        </div>
        {assets && tipContent && tip && <TalentTooltip anchorId={tipAnchor!} id="talent-tooltip" content={tipContent} />}

        {/* Without the game's tooltips this panel is how a talent's row, needs and spell id are read. With them, the tooltip says it. */}
        {!assets && selectedNode && (
          <section aria-label="Selected talent" className="mx-4 mb-4 space-y-1 rounded-control border border-line bg-canvas p-4 text-sm text-fg-2">
            <p className="font-semibold text-fg">{selectedNode.entries.map((e) => e.name).join(selectedNode.kind === "choice" ? " or " : ", then ")}</p>
            <p className="font-mono text-xs tabular-nums text-muted">
              Row {selectedNode.row}, max rank {selectedNode.maxRanks}
              {selectedNode.entries.map((e) => e.spellId).filter(Boolean).length > 0 && ` · spell id ${selectedNode.entries.map((e) => e.spellId).filter(Boolean).join(", ")}`}
            </p>
            {selectedNode.unlock?.pointsInTree ? <p>Opens after {selectedNode.unlock.pointsInTree} points in this tree, on the rows above.</p> : null}
            {selectedNode.unlock?.pointsTotal ? <p>Opens after {selectedNode.unlock.pointsTotal} points spent in the class&apos;s trees.</p> : null}
            {selectedNode.unlock?.ranksInNodes?.map((r) => <p key={r.nodeId}>Needs {r.ranks} {r.ranks === 1 ? "rank" : "ranks"} in {nameOf(r.nodeId)}.</p>)}
            {selectedNode.prereqs.length > 0 && <p>Needs {selectedNode.prereqs.map(nameOf).join(", ")} at full rank.</p>}
            {(selectedNode.anyOf?.length ?? 0) > 0 && <p>Needs {selectedNode.anyOf!.map(nameOf).join(" or ")} at full rank.</p>}
            <p className="text-muted">Description: not shown yet.</p>
          </section>
        )}

        {/* The set's spend order, after the trees and outside the phone's sticky switch. */}
        {!readOnly && (
          <LevelingOrder catalog={catalog} set={set} slot={active} setName={setName} moved={moves?.after === set ? moves.points : []}
            preview={previewing} onPreview={showPreview} onMove={doMove} refused={refused?.set === set ? refused : null}
            onEdit={(next, text) => { setActiveSet(next); setMessage(text); }} onMessage={setMessage} />
        )}

        {!readOnly && <section aria-label="Share" className="grid gap-3 border-t border-line p-4 md:grid-cols-2">
          <div className="flex flex-wrap items-center gap-3 md:col-span-2">
            <CopyButton className="btn text-sm" text={addonLink} label="Copy for addon" disabled={!codes[active]}
              onResult={(ok) => setMessage(ok
                ? `Copied ${setName} as a link. In the game: /everloot, the Talents tab, paste, then Import. Addon 0.3.12 loads its talents, not its spend order.`
                : "Copy failed. Select and copy the share link instead.")} />
            <p className="text-sm text-fg-2">
              Copies {setName} only, as a link. In the addon: <code>/everloot</code> → Talents tab → paste → Import. Addon 0.3.12 loads the
              talents from it but not the spend order, so spend each point yourself.
            </p>
          </div>
          {/* The plan goes to Plans on this device in the address fragment, which never reaches the server; it is named
              and kept there. This page reads no saved plan. */}
          <div className="flex flex-wrap items-center gap-3 md:col-span-2">
            {codes[0]
              ? <a className="btn text-sm" href={`/tools/builds${planHash(codes[0], codes[1], orders[0], orders[1])}`}>Save on this device</a>
              : <button type="button" className="btn text-sm" disabled>Save on this device</button>}
            <p className="text-sm text-fg-2">
              {codes[0]
                ? "Opens Plans on this device with this plan, to name it there. Kept in this browser only; nothing is uploaded."
                : "Spend a point in set 1 to save this plan on this device."}
            </p>
          </div>
          <div className="min-w-0 space-y-1">
            <label className="block text-sm text-fg-2" htmlFor="talent-link">Link to this build, both sets (game build {catalog.build})</label>
            <div className="flex gap-2">
              <Input id="talent-link" mono readOnly value={link} placeholder="Spend a point and the page address becomes the link" onFocus={(e) => e.currentTarget.select()} className="flex-1 text-xs" />
              <CopyButton className="btn px-3 text-sm sm:px-5" text={link} label="Copy" onResult={onCopied} disabled={!link} />
            </div>
          </div>
          <form className="min-w-0 space-y-1" onSubmit={(e) => { e.preventDefault(); load(pasted); }}>
            <label className="block text-sm text-fg-2" htmlFor="talent-paste">Share code or link</label>
            <div className="flex gap-2">
              <Input id="talent-paste" mono value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste a share code or link" className="flex-1 text-xs" />
              <button type="submit" className="btn px-3 text-sm sm:px-5" disabled={previewing !== null}>Load into {setName}</button>
            </div>
          </form>
          {report && (
            <section aria-label="What loaded" className="space-y-2 rounded-control border border-line bg-canvas p-4 text-sm text-fg-2 md:col-span-2">
              <p className="font-semibold text-fg">
                {report.problems.length === 0 ? "Loaded as made." : `Loaded, with ${report.problems.length} ${report.problems.length === 1 ? "change" : "changes"}.`}
              </p>
              <p className="font-mono text-xs text-muted">Made on build {report.codeBuild} · this tree is build {report.treeBuild}</p>
              {report.problems.length > 0 && (
                <ul className="list-disc space-y-1 pl-5">
                  {report.problems.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              )}
            </section>
          )}
        </section>}
      </Card>
    </div>
  );
}

/** One figure in the build bar: a small label over a mono number. */
function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="font-mono text-xl font-semibold tabular-nums text-fg">{value}</span>
    </div>
  );
}
