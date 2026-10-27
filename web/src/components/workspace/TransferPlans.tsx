"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ACCOUNT_CHANGED_EVENT } from "@/components/AccountControls";
import { className } from "@/components/builds/describe";
import { Card, Field, SectionHeading } from "@/components/ui";
import { detailValue, listOf } from "@/lib/alt-workspace";
import {
  ANONYMOUS, WORKSPACE_LIMITS, bindTransferred, boundElsewhere, bucketKey, deviceStorage, emptyWorkspace, orderState, planGroups,
  readWorkspace, settleTransferred, transferRoom, transferStanding, withWorkspaceLock,
  type Failure, type LocalAlt, type LocalPlan, type Owner, type PlayerWorkspace, type Standing,
} from "@/lib/player-workspace";
import {
  ACCOUNT_MISMATCH, BUILDS_PER_ACCOUNT, CHARACTERS_PER_ACCOUNT, EXPECTED_OWNER_HEADER, LIMITS, ORDERS_UNAVAILABLE, parseCharacterInput,
  type AccountBuilds,
} from "@/lib/saved-builds";
import { useWorkspaceOwner } from "./LocalPlanSave";

// /tools/builds, signed in: the plans this browser keeps signed out (lib/player-workspace.ts), saved to the account
// signed in now when the player asks. The account is asked nothing until the transfer is opened, and a plan is sent
// only once its build is chosen private or shared: Save in the calculator starts a build shared, Chat starts one
// private, and here neither is picked. Plans an alt uses go together, and the alt goes with them, whole, to this
// account's side of this device; on the account it can only be a character, and what does not fit one is shown and
// filled in by the player before anything is sent, never cut. Every write names the account (EXPECTED_OWNER_HEADER),
// and an account change stops the transfer before its next write. A plan the site has saved is bound to that account
// on this device at once (bindTransferred), so trying again does not send it twice, and another account is refused it.

type AccountOwner = Extract<Owner, { kind: "account" }>;
type Sharing = "" | "private" | "shared" | "shared-name";

const SHARING: Record<Exclude<Sharing, "">, { label: string; words: string; shared: boolean; showName: boolean }> = {
  private: { label: "Private: no share link", words: "as a private build", shared: false, showName: false },
  shared: { label: "Share link on, my name hidden", words: "with its share link on and your name hidden", shared: true, showName: false },
  "shared-name": { label: "Share link on, my name shown", words: "with its share link on and your name shown", shared: true, showName: true },
};

const CHANGED = "The account signed in here changed, so the transfer stopped.";
const KEPT = "What was not saved is still on this device, as it was.";
const select = "min-h-11 w-full rounded-control border border-edge bg-canvas px-3 text-base text-fg";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const day = (at: string) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
/** Characters as the account counts them. */
const length = (s: string) => Array.from(s).length;

/** Each set's spend order, as the account will keep it. */
function ordersLine(plan: LocalPlan): string {
  return ([[plan.code, plan.order], [plan.code2, plan.order2]] as const).flatMap(([code, token], i) => {
    if (!code) return [];
    const state = orderState(code, token);
    return [`Set ${i + 1}: ${state.known ? `${state.origin} order` : state.reason === "none" ? "order unknown" : "order unreadable"}`];
  }).join(" · ");
}

/** Why a plan cannot go as it is: a set's spend order this version cannot read, which the account would not keep.
 *  Dropping it is the player's call, made in the calculator, never made here. */
function unreadableOrder(plan: LocalPlan): string | null {
  const sets = [[plan.code, plan.order], [plan.code2, plan.order2]] as const;
  for (const [i, [code, token]] of sets.entries()) {
    if (code === null || token === null) continue;
    const state = orderState(code, token);
    if (state.known) continue;
    return state.reason === "newer-version"
      ? `${plan.name}: set ${i + 1}'s spend order was made by a newer version of Everloot, and your account would lose it, so it is not saved. Reload the page for the newest Everloot, then try again.`
      : `${plan.name}: set ${i + 1}'s spend order cannot be read here, and your account would lose it, so it is not saved. To save it without one, open it in the calculator and save it on this device again first.`;
  }
  return null;
}

function standingLine(plan: LocalPlan, standing: Standing): string | null {
  switch (standing.kind) {
    case "saved": return `${plan.name} is in your account already (saved ${day(standing.at)}), so it is not sent again.`;
    case "changed": return `${plan.name} is in your account already, saved ${day(standing.at)}, and was changed here after that. Saving it again would make a second build, so it is left as it is. To keep this version too, sign out, make a copy of it on this page and save the copy.`;
    case "elsewhere": return `${plan.name} was saved to another account from this browser, so it is not saved to this one as well. To have it here too, sign out, make a copy of it on this page and save the copy.`;
    default: return null;
  }
}

/** A character for the account made from an alt, as the player has it. */
interface NewCharacter { name: string; realm: string; note: string }

/** What of an alt fits a character on the account as it is. What does not starts empty, for the player to fill in. */
function startCharacter(alt: LocalAlt): NewCharacter {
  const fits = (text: string | null, limit: number) => text !== null && length(text) <= limit && !text.includes("\n");
  return {
    name: fits(alt.name, LIMITS.characterName) ? alt.name : "",
    realm: alt.realm !== null && fits(alt.realm, LIMITS.realm) ? alt.realm : "",
    note: fits(alt.notes, LIMITS.note) ? alt.notes : "",
  };
}

/** An alt's details a character on the account has no place for. */
const unkept = (alt: LocalAlt) =>
  [alt.level !== null ? `Level ${alt.level}` : "", alt.faction ? detailValue("faction", alt.faction) : "", alt.professions.join(", ")].filter(Boolean);

interface Row {
  plan: LocalPlan;
  standing: Standing;
  /** What the preview says of it: why it is refused, or that the account has it already. */
  line: string | null;
  refused: boolean;
  /** Its alts of its own class: each can be its character on the account. */
  alts: LocalAlt[];
}
interface Group { key: string; rows: Row[]; alts: LocalAlt[]; watches: number; refused: boolean }

/** The signed-out plans in the groups they go in (planGroups), each as it stands with the account. */
function groupsOf(signedOut: PlayerWorkspace, account: PlayerWorkspace, elsewhere: Set<string>, readable: boolean): Group[] {
  const plans = new Map(signedOut.plans.map((p) => [p.id, p]));
  const alts = new Map(signedOut.alts.map((a) => [a.id, a]));
  return planGroups(signedOut).map(({ planIds, altIds }) => {
    const groupAlts = altIds.map((id) => alts.get(id)!);
    const rows = planIds.map((id): Row => {
      const plan = plans.get(id)!;
      const standing = transferStanding(plan, account, elsewhere);
      const unreadable = standing.kind === "new" ? unreadableOrder(plan) : null;
      return {
        plan, standing, line: unreadable ?? standingLine(plan, standing),
        refused: !readable || unreadable !== null || standing.kind === "changed" || standing.kind === "elsewhere",
        alts: groupAlts.filter((a) => a.planIds.includes(id) && a.classSlug === plan.classSlug),
      };
    });
    return { key: planIds[0], rows, alts: groupAlts, watches: signedOut.watches.filter((w) => planIds.includes(w.planId)).length, refused: rows.some((r) => r.refused) };
  });
}

/** One plan's choices: its sharing, and its character, "" for none, an account character's id, or `alt:<id>` for one
 *  made from that alt. */
interface Choice { sharing: Sharing; character: string }
const NO_CHOICE: Choice = { sharing: "", character: "" };
const altOf = (character: string) => (character.startsWith("alt:") ? character.slice(4) : null);

type Answer = { ok: true; body: Record<string, unknown> } | { ok: false; why: "stopped" | "changed" | "orders" | "signed-out" | "unreachable" | "refused"; message: string };

export default function TransferPlans() {
  const [state, recheck] = useWorkspaceOwner({ strict: true });
  const owner = state.status === "ready" && state.owner.kind === "account" ? state.owner : null;
  // Why the last transfer stopped when the account here changed, for whoever is here now.
  const [stopped, setStopped] = useState<string | null>(null);
  const notice = stopped ? <p role="alert" className="mb-6 text-sm text-fg">{stopped}</p> : null;
  if (!owner) return notice;
  // One account at a time: another one remounts the transfer, so nothing chosen for one account is sent for the next.
  return (
    <>
      {notice}
      <Transfer key={bucketKey(owner)} owner={owner} recheck={recheck} onStopped={setStopped} />
    </>
  );
}

function Transfer({ owner, recheck, onStopped }: { owner: AccountOwner; recheck: () => void; onStopped: (text: string | null) => void }) {
  const [device, setDevice] = useState<{ signedOut: PlayerWorkspace; account: PlayerWorkspace | null; elsewhere: Set<string> } | null>(null);
  const reload = useCallback(() => {
    const storage = deviceStorage();
    const signedOut = readWorkspace(storage, ANONYMOUS);
    if (!signedOut.ok) { setDevice(null); return; }
    const account = readWorkspace(storage, owner);
    setDevice({
      signedOut: signedOut.workspace, account: account.ok ? account.workspace : null,
      elsewhere: boundElsewhere(storage, owner, signedOut.workspace.plans.map((p) => p.id)),
    });
  }, [owner]);
  useEffect(() => {
    reload();
    // Another tab's change shows here too, and so does one this transfer makes.
    window.addEventListener("storage", reload);
    return () => window.removeEventListener("storage", reload);
  }, [reload]);
  /** False once this account's transfer is over: unmounted for another account, or signed out in this tab. */
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    const end = () => { live.current = false; };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, end);
    return () => { live.current = false; window.removeEventListener(ACCOUNT_CHANGED_EVENT, end); };
  }, []);

  const [account, setAccount] = useState<{ status: "closed" | "loading" } | { status: "open"; data: AccountBuilds } | { status: "failed"; message: string }>({ status: "closed" });
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [characters, setCharacters] = useState<Record<string, NewCharacter>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ text: string; alert: boolean } | null>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (account.status === "open") list.current?.querySelector<HTMLInputElement>("input:not(:disabled)")?.focus();
  }, [account.status]);

  /** The account's builds and characters, asked for the account this tab confirmed, only when the player opens this. */
  async function open() {
    onStopped(null);
    setOutcome(null);
    setAccount({ status: "loading" });
    try {
      const response = await fetch("/api/me/builds", { cache: "no-store", headers: { [EXPECTED_OWNER_HEADER]: owner.userId } });
      const body = await response.json().catch(() => ({}));
      if (!live.current) return;
      // Checking the account again starts this over, for whichever account it finds.
      if (response.status === 409 && body.code === ACCOUNT_MISMATCH) { onStopped("The account signed in here changed, so nothing was sent."); recheck(); return; }
      if (response.status === 401) { onStopped("You are signed out now, so nothing was sent."); recheck(); return; }
      if (response.status === 404) { setAccount({ status: "failed", message: "Saving plans to an account isn't available right now. Your plans stay on this device." }); return; }
      if (!response.ok) throw new Error("unavailable");
      setIncluded(new Set());
      setChoices({});
      setCharacters({});
      setAccount({ status: "open", data: body as AccountBuilds });
    } catch {
      if (live.current) setAccount({ status: "failed", message: "Your account could not be read, so nothing was sent. Try again in a minute." });
    }
  }

  function cancel() {
    setAccount({ status: "closed" });
    setIncluded(new Set());
    setChoices({});
    setCharacters({});
  }

  if (!device) return null;
  const count = device.signedOut.plans.length;
  const said = outcome && <p role={outcome.alert ? "alert" : "status"} className={`mb-3 text-sm ${outcome.alert ? "text-danger" : "text-fg-2"}`}>{outcome.text}</p>;
  if (count === 0) return said ? <div className="mb-8">{said}</div> : null;

  const readable = device.account !== null;
  const accountBucket = device.account ?? emptyWorkspace(owner);
  const groups = groupsOf(device.signedOut, accountBucket, device.elsewhere, readable);
  const altsById = new Map(device.signedOut.alts.map((a) => [a.id, a]));
  const choiceOf = (id: string) => choices[id] ?? NO_CHOICE;
  const characterOf = (alt: LocalAlt) => characters[alt.id] ?? startCharacter(alt);
  const chosen = groups.filter((g) => included.has(g.key) && !g.refused);
  const rows = chosen.flatMap((g) => g.rows);
  const sending = rows.filter((r) => r.standing.kind === "new");
  const altIds = [...new Set(sending.map((r) => altOf(choiceOf(r.plan.id).character)).filter((id): id is string => id !== null))];
  const characterErrors = new Map(altIds.map((id) => {
    const alt = altsById.get(id)!;
    const draft = characterOf(alt);
    const parsed = parseCharacterInput({ id: null, name: draft.name, classSlug: alt.classSlug, realm: draft.realm, note: draft.note });
    return [id, parsed.ok ? null : parsed.error];
  }));

  // What stops Save, said before anything is sent.
  const problems: string[] = [];
  if (account.status === "open") {
    const { data } = account;
    for (const r of sending) if (!choiceOf(r.plan.id).sharing) problems.push(`Choose private or a share link for ${r.plan.name}.`);
    for (const id of altIds) if (characterErrors.get(id)) problems.push(`Fill in the new character from ${altsById.get(id)!.name}.`);
    const builds = BUILDS_PER_ACCOUNT - data.builds.length;
    const are = sending.length === 1 ? "is" : "are";
    if (sending.length > builds) {
      problems.push(builds > 0
        ? `Your account has room for ${plural(builds, "more build")}, and ${sending.length} ${are} chosen.`
        : `Your account has ${BUILDS_PER_ACCOUNT} builds, as many as it can have, and ${sending.length} ${are} chosen.`);
    }
    const room = CHARACTERS_PER_ACCOUNT - data.characters.length;
    if (altIds.length > room) {
      problems.push(room > 0
        ? `Your account has room for ${plural(room, "more character")}, and this would make ${altIds.length}.`
        : `Your account has ${CHARACTERS_PER_ACCOUNT} characters, as many as it can have, and this would make ${altIds.length} more.`);
    }
    const full = rows.length > 0 && device.account ? transferRoom(device.signedOut, device.account, rows.map((r) => r.plan.id)) : null;
    if (full) {
      problems.push(full.error === "over-limit"
        ? `This account's plans on this device have no room for these: a device keeps ${WORKSPACE_LIMITS.plans} plans and ${WORKSPACE_LIMITS.alts} alts, all within a 1 MiB backup.`
        : full.message);
    }
  }

  // What Save does, plan by plan, then the characters it makes and what moves on this device.
  function characterWords(character: string): string {
    const alt = altsById.get(altOf(character) ?? "");
    if (alt) return `under ${characterOf(alt).name.trim() || alt.name}, a new character`;
    const existing = account.status === "open" ? account.data.characters.find((c) => c.id === character) : undefined;
    return existing ? `under ${existing.name}` : "with no character";
  }
  const lines = rows.map((r) => {
    if (r.standing.kind === "saved") return `${r.plan.name} is in your account already: saving finishes moving it here, without a second save.`;
    const choice = choiceOf(r.plan.id);
    return `Saves ${r.plan.name} to your account ${choice.sharing ? SHARING[choice.sharing].words : "with its sharing not chosen yet"}, ${characterWords(choice.character)}.`;
  });
  for (const id of altIds) {
    const alt = altsById.get(id)!;
    const name = characterOf(alt).name.trim();
    lines.push(name ? `Makes the character ${name} (${className(alt.classSlug!)}) on your account.` : `Makes a character from ${alt.name} on your account.`);
  }
  const alts = chosen.reduce((n, g) => n + g.alts.length, 0);
  const watches = chosen.reduce((n, g) => n + g.watches, 0);
  if (rows.length > 0) {
    const moving = [plural(rows.length, "plan"), alts > 0 ? plural(alts, "alt") : "", watches > 0 ? plural(watches, "watch", "watches") : ""].filter(Boolean);
    lines.push(`Moves ${listOf(moving)} from the signed-out plans to this account's on this device.`);
  }

  /** Tells this page's other readers of these buckets (Plans on this device) that they changed, as other tabs are told. */
  function tell() {
    for (const key of [bucketKey(ANONYMOUS), bucketKey(owner)]) window.dispatchEvent(new StorageEvent("storage", { key }));
  }

  /** One write, naming this account: the site refuses it if another account is signed in now. */
  async function post(url: string, body: object): Promise<Answer> {
    if (!live.current) return { ok: false, why: "stopped", message: "" };
    let response: Response;
    try {
      response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", [EXPECTED_OWNER_HEADER]: owner.userId }, body: JSON.stringify(body) });
    } catch {
      return { ok: false, why: "unreachable", message: "" };
    }
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.ok) return { ok: true, body: result };
    if (response.status === 409 && result.code === ACCOUNT_MISMATCH) return { ok: false, why: "changed", message: "" };
    if (response.status === 409 && result.error === ORDERS_UNAVAILABLE) return { ok: false, why: "orders", message: "" };
    if (response.status === 401) return { ok: false, why: "signed-out", message: "" };
    return { ok: false, why: "refused", message: typeof result.error === "string" ? result.error : "That did not work." };
  }

  async function send() {
    if (account.status !== "open" || busy || rows.length === 0 || problems.length > 0) return;
    // What was chosen, as the preview showed it: the work does not change if the page does while it runs.
    const work = chosen.map((g) => g.rows);
    const picked = { ...choices };
    const drafts = new Map(altIds.map((id) => [id, characterOf(altsById.get(id)!)]));
    /** The characters the account made from alts, so two plans of one alt share one. */
    const made = new Map<string, string>();
    const saved: string[] = [];
    let finished = 0;
    const savedFirst = () => (saved.length > 0 ? `Saved ${listOf(saved)} to your account. ` : "");
    const unrecorded = (failed: Failure) => (failed.error === "left-signed-out"
      ? `${savedFirst()}${failed.message} Trying again does not save ${listOf(saved)} twice.`
      : `${savedFirst()}But this browser could not record that, so a plan your account has may still show here signed out, and saving it again would make a second build. Check My builds before you try again.`);
    /** Why the transfer stopped at `name`, or null when it stopped for an account change, which the page says instead. */
    const refusal = (answer: Extract<Answer, { ok: false }>, name: string): string | null => {
      const twice = saved.length > 0 ? ` Trying again does not save ${listOf(saved)} twice.` : "";
      switch (answer.why) {
        case "stopped": return null;
        case "changed":
          onStopped(`${CHANGED} ${saved.length > 0 ? `${listOf(saved)} ${saved.length === 1 ? "was" : "were"} saved to the account you started with first. ` : "Nothing was saved. "}${KEPT}`);
          recheck();
          return null;
        case "signed-out":
          onStopped(`You are signed out now, so the transfer stopped. ${savedFirst()}${KEPT}`);
          recheck();
          return null;
        case "orders":
          return saved.length === 0
            ? "Saving spend orders isn't available yet, so no plans were saved to your account. They stay on this device as they were, spend orders included."
            : `${savedFirst()}Saving spend orders isn't available yet, so ${name} and the plans after it were not saved. They stay on this device as they were, spend orders included.${twice}`;
        case "unreachable":
          return `${savedFirst()}Your account could not be reached while ${name} was being saved, so it may or may not be in your account. Check My builds before you try again, or it may be saved twice.`;
        default:
          return `${savedFirst()}${name} was not saved: ${answer.message} ${KEPT}${twice}`;
      }
    };

    setBusy(true);
    const stop = await (async (): Promise<string | null> => {
      for (const group of work) {
        for (const row of group) {
          if (!live.current) return null;
          // The plan and the account's plans as stored now, not as the preview read them.
          const storage = deviceStorage();
          const signedOut = readWorkspace(storage, ANONYMOUS);
          const mine = readWorkspace(storage, owner);
          if (!mine.ok) return `${savedFirst()}This account's plans on this device could not be read, so nothing more was sent. ${KEPT}`;
          const plan = signedOut.ok ? signedOut.workspace.plans.find((p) => p.id === row.plan.id) : undefined;
          // Moved already with its group, once the group's last plan was saved: the account's bucket has it, bound to it.
          if (!plan && mine.workspace.plans.some((p) => p.id === row.plan.id && p.boundTo !== null)) { finished++; continue; }
          const same = plan !== undefined && JSON.stringify(plan) === JSON.stringify(row.plan);
          const standing = plan ? transferStanding(plan, mine.workspace, boundElsewhere(storage, owner, [plan.id])) : null;
          // The account has it already, from this preview or from another tab since: it is not sent again.
          if (same && standing?.kind === "saved") { finished++; continue; }
          // Changed or gone in another tab since the preview, or saved somewhere by one: not sent.
          if (!plan || !same || standing?.kind !== "new" || row.standing.kind !== "new") {
            return `${savedFirst()}${row.plan.name} changed on this device after the preview, so it was not sent. ${KEPT}`;
          }
          const choice = picked[plan.id] ?? NO_CHOICE;
          const altId = altOf(choice.character);
          let characterId = altId ? made.get(altId) ?? null : choice.character || null;
          if (altId && !characterId) {
            const draft = drafts.get(altId)!;
            const answer = await post("/api/me/characters", { name: draft.name, classSlug: altsById.get(altId)!.classSlug, realm: draft.realm, note: draft.note });
            if (!answer.ok) return refusal(answer, plan.name);
            characterId = String((answer.body.character as { id?: unknown } | undefined)?.id ?? "");
            made.set(altId, characterId);
          }
          const { shared, showName } = SHARING[choice.sharing as Exclude<Sharing, "">];
          const answer = await post("/api/me/builds", {
            name: plan.name, notes: plan.notes, characterId, code: plan.code, code2: plan.code2, shared, showName, order: plan.order, order2: plan.order2,
          });
          if (!answer.ok) return refusal(answer, plan.name);
          // The account has it: bound to that account on this device at once, whoever is signed in here when it lands.
          saved.push(plan.name);
          const bound = await withWorkspaceLock(() => bindTransferred(deviceStorage(), { owner, planIds: [plan.id] }, { ok: true, userId: owner.userId, planIds: [plan.id] }));
          tell();
          if (!bound.ok) return unrecorded(bound);
        }
        if (!live.current) return null;
        const settled = await withWorkspaceLock(() => settleTransferred(deviceStorage(), owner, group.map((r) => r.plan.id)));
        tell();
        if (!settled.ok) return unrecorded(settled);
      }
      return "";
    })();
    if (!live.current) {
      // Signed out here, or another account: the transfer stopped before its next write. Say what it did.
      if (stop !== "") onStopped(`${CHANGED} ${saved.length > 0 ? `${listOf(saved)} ${saved.length === 1 ? "was" : "were"} saved to the account you started with before then. ` : ""}${KEPT}`);
      return;
    }
    setBusy(false);
    setAccount({ status: "closed" });
    setIncluded(new Set());
    setChoices({});
    setCharacters({});
    if (stop === null) return;
    setOutcome(stop === ""
      ? { text: saved.length > 0 ? `Saved ${plural(saved.length, "plan")} to your account.` : `Finished moving ${plural(finished, "plan")} your account had already.`, alert: false }
      : { text: stop, alert: true });
    reload();
  }

  return (
    <Card as="section" aria-labelledby="transfer-plans" className="mb-8">
      <SectionHeading id="transfer-plans">Plans saved here while signed out</SectionHeading>
      {said}
      <p className="text-sm text-fg-2">
        {plural(count, "plan")} on this device {count === 1 ? "was" : "were"} saved while signed out, so {count === 1 ? "it is" : "they are"} not in your account. Choose which to save to it. Nothing is sent until you do.
      </p>
      {account.status === "closed" && <button type="button" className="btn mt-4 text-sm" onClick={open}>Choose plans to save to your account</button>}
      {account.status === "loading" && <p role="status" className="mt-4 text-sm text-muted">Reading your account…</p>}
      {account.status === "failed" && (
        <div className="mt-4 space-y-3">
          <p role="alert" className="text-sm text-fg">{account.message}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn text-sm" onClick={open}>Try again</button>
            <button type="button" className="btn text-sm" onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}
      {account.status === "open" && (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-fg">
            Saving to your account, the one signed in here now. It has {account.data.builds.length} of {BUILDS_PER_ACCOUNT} builds and {account.data.characters.length} of {CHARACTERS_PER_ACCOUNT} characters.
          </p>
          <p className="text-sm text-fg-2">
            Save in the talent calculator starts a build with its share link on, so anyone with the link can open it, and your name hidden. Builds made in Chat start private. Nothing is picked for you here: choose for each plan.
          </p>
          <p className="text-sm text-fg-2">
            Once your account has a plan, this device keeps it with this account&apos;s plans, not the signed-out ones, with any alt or watch that uses it. Alts are not sent: a plan can be filed under a character on your account made from one.
          </p>
          {!readable && (
            <p role="alert" className="text-sm text-fg">This account&apos;s plans on this device could not be read, so this device could not record what your account has. Nothing can be saved from here until they can.</p>
          )}
          <ul ref={list} className="divide-y divide-line border-y border-line">
            {groups.map((group) => (
              <GroupItem key={group.key} group={group} included={included.has(group.key)} disabled={busy}
                characters={account.data.characters} choiceOf={choiceOf} characterOf={characterOf} characterErrors={characterErrors}
                onInclude={(on) => setIncluded((now) => { const next = new Set(now); if (on) next.add(group.key); else next.delete(group.key); return next; })}
                onChoice={(planId, choice) => setChoices((now) => ({ ...now, [planId]: choice }))}
                onCharacter={(altId, draft) => setCharacters((now) => ({ ...now, [altId]: draft }))} />
            ))}
          </ul>
          {rows.length > 0 && (
            <div role="group" aria-label="What saving does" className="space-y-1 rounded-control border border-line bg-canvas p-3 text-sm text-fg">
              {/* Two plans of one name read alike, so a line is known by its place. */}
              {lines.map((line, i) => <p key={i}>{line}</p>)}
            </div>
          )}
          {problems.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-fg-2">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-primary text-sm" disabled={busy || rows.length === 0 || problems.length > 0} aria-busy={busy} onClick={send}>Save to your account</button>
            <button type="button" className="btn text-sm" disabled={busy} onClick={cancel}>Cancel</button>
            {busy && <p role="status" className="text-sm text-muted">Saving to your account…</p>}
          </div>
        </div>
      )}
    </Card>
  );
}

function GroupItem({ group, included, disabled, characters, choiceOf, characterOf, characterErrors, onInclude, onChoice, onCharacter }: {
  group: Group;
  included: boolean;
  disabled: boolean;
  characters: AccountBuilds["characters"];
  choiceOf: (planId: string) => Choice;
  characterOf: (alt: LocalAlt) => NewCharacter;
  characterErrors: Map<string, string | null>;
  onInclude: (on: boolean) => void;
  onChoice: (planId: string, choice: Choice) => void;
  onCharacter: (altId: string, draft: NewCharacter) => void;
}) {
  const names = group.rows.map((r) => r.plan.name);
  const altNames = listOf(group.alts.map((a) => a.name));
  const one = group.rows.length === 1;
  const single = group.alts.length === 1;
  // The alts some plan of this group is to be filed under, each made into a character once.
  const chosenAlts = group.alts.filter((a) => included && group.rows.some((r) => r.standing.kind === "new" && choiceOf(r.plan.id).character === `alt:${a.id}`));
  return (
    <li className="space-y-3 py-4">
      <label className="flex min-h-11 items-center gap-3 font-semibold text-fg">
        <input type="checkbox" className="size-5 shrink-0" checked={included && !group.refused} disabled={disabled || group.refused} onChange={(e) => onInclude(e.target.checked)} />
        <span className="min-w-0 [overflow-wrap:anywhere]">Save {listOf(names)} to your account</span>
      </label>
      {group.alts.length > 0 && (
        <p className="text-sm text-fg-2">
          {one
            ? `${altNames} ${single ? "uses" : "use"} it, so ${altNames} ${single ? "moves" : "move"} with it to this account's alts on this device.`
            : `${altNames} ${single ? "uses" : "use"} these, so they go together, and ${altNames} ${single ? "moves" : "move"} with them to this account's alts on this device.`}
          {group.refused && !one && " None of them can be saved until each can."}
        </p>
      )}
      {group.rows.map((row) => {
        const choice = choiceOf(row.plan.id);
        return (
          <div key={row.plan.id} className="space-y-2">
            <p className="text-sm text-fg [overflow-wrap:anywhere]">
              <span className="font-semibold">{row.plan.name}</span>{" "}
              <span className="text-meta text-muted">{className(row.plan.classSlug)} · {ordersLine(row.plan)}</span>
            </p>
            {row.line && <p className={`text-sm ${row.refused ? "text-danger" : "text-fg-2"}`}>{row.line}</p>}
            {included && !group.refused && row.standing.kind === "new" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1 text-sm">
                  <span className="block text-muted">Sharing for {row.plan.name}</span>
                  <select value={choice.sharing} disabled={disabled} className={select} onChange={(e) => onChoice(row.plan.id, { ...choice, sharing: e.target.value as Sharing })}>
                    <option value="">Choose private or a share link</option>
                    {(Object.keys(SHARING) as Exclude<Sharing, "">[]).map((key) => <option key={key} value={key}>{SHARING[key].label}</option>)}
                  </select>
                </label>
                <label className="block space-y-1 text-sm">
                  <span className="block text-muted">Character for {row.plan.name}</span>
                  <select value={choice.character} disabled={disabled} className={select} onChange={(e) => onChoice(row.plan.id, { ...choice, character: e.target.value })}>
                    <option value="">No character</option>
                    {characters.filter((c) => c.classSlug === row.plan.classSlug).map((c) => <option key={c.id} value={c.id}>{c.realm ? `${c.name} (${c.realm})` : c.name}</option>)}
                    {row.alts.map((a) => <option key={a.id} value={`alt:${a.id}`}>{`New character from your alt ${a.name}`}</option>)}
                  </select>
                </label>
              </div>
            )}
          </div>
        );
      })}
      {chosenAlts.map((alt) => (
        <CharacterFields key={alt.id} alt={alt} draft={characterOf(alt)} error={characterErrors.get(alt.id) ?? null} disabled={disabled} onChange={(draft) => onCharacter(alt.id, draft)} />
      ))}
    </li>
  );
}

/** A character for the account made from an alt: what fits is filled in, what does not is said, for the player to fill
 *  in, and what the account has no place for stays with the alt here. */
function CharacterFields({ alt, draft, error, disabled, onChange }: {
  alt: LocalAlt; draft: NewCharacter; error: string | null; disabled: boolean; onChange: (draft: NewCharacter) => void;
}) {
  const nameLength = length(alt.name);
  const realmLength = alt.realm === null ? 0 : length(alt.realm);
  const noteLength = length(alt.notes);
  const noteLines = alt.notes.split("\n").length;
  const left = unkept(alt);
  return (
    <fieldset className="grid gap-3 rounded-control border border-line bg-canvas p-3 sm:grid-cols-2">
      <legend className="px-1 text-sm text-fg">New character on your account, from your alt {alt.name}</legend>
      <p className="text-sm text-fg-2 sm:col-span-2">Class: {className(alt.classSlug!)}, as the alt&apos;s.</p>
      <div className="space-y-1">
        <Field label="Character name" required maxLength={LIMITS.characterName} value={draft.name} disabled={disabled} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
        {nameLength > LIMITS.characterName && (
          <p className="text-sm text-fg-2">{alt.name}&apos;s name here has {nameLength} characters; a character name on your account has up to {LIMITS.characterName}. Type the name to use there.</p>
        )}
      </div>
      <div className="space-y-1">
        <Field label="Realm (optional)" maxLength={LIMITS.realm} value={draft.realm} disabled={disabled} onChange={(e) => onChange({ ...draft, realm: e.target.value })} />
        {realmLength > LIMITS.realm && (
          <p className="text-sm text-fg-2">The realm here has {realmLength} characters; a realm on your account has up to {LIMITS.realm}. Type it shorter, or leave it out.</p>
        )}
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Field label="Note (optional)" maxLength={LIMITS.note} value={draft.note} disabled={disabled} onChange={(e) => onChange({ ...draft, note: e.target.value })} />
        {(noteLength > LIMITS.note || noteLines > 1) && (
          <p className="text-sm text-fg-2">
            {alt.name}&apos;s notes here have {noteLength} characters{noteLines > 1 ? ` over ${noteLines} lines` : ""}; a note on your account is one line of up to {LIMITS.note}. Write one, or leave it empty: the notes stay with {alt.name} on this device, in full.
          </p>
        )}
      </div>
      {left.length > 0 && (
        <p className="text-sm text-fg-2 sm:col-span-2">Not kept on your account: {left.join(" · ")}. {left.length === 1 ? "It stays" : "They stay"} with {alt.name} on this device.</p>
      )}
      {error && <p className="text-sm text-danger sm:col-span-2">{error}</p>}
    </fieldset>
  );
}
