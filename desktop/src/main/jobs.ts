import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { answerPending, createAnswerStore } from "../../../companion/src/bridge/run";
import { lazyEngine, mcpAnswerSources, mcpEngine, mcpMarketValue, siteItemSearch, withMarket } from "../../../companion/src/bridge/engine";
import { llmEngine } from "../../../companion/src/bridge/llm-engine";
import { providersOnDemand } from "../../../companion/src/providers/config";
import { linkSummary, sendLinks } from "../../../companion/src/link-sender";
import { refreshDungeonProgress } from "../../../companion/src/dungeon-progress";
import { findEverlootFiles } from "../../../companion/src/savedvariables";
import { createSentState } from "../../../companion/src/sent-state";
import { createSiteCollects } from "../../../companion/src/site-collects";
import { sendSync, syncSummary } from "../../../companion/src/sync-sender";
import { uploadFile } from "../../../companion/src/uploader";
import { watchFile } from "../../../companion/src/watch-file";
import { appSettledList } from "../../../web/src/lib/settled-cache";
import type { CharacterLinkStatus, RealmSummary, Settings } from "../shared/types";
import { accountKeyForSite } from "./account";
import { backupSavedVariables } from "./backups";
import { pruneSettledLists } from "./data-folder";
import type { EngineDeps } from "./engine";
import { characterRealms, refreshMarket } from "./market";
import { readyFacts, saveFacts } from "./save-facts";
import { readForUpload } from "./save-reader";

const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])];
const without = (a: readonly string[], b: readonly string[]) => a.filter((x) => !b.includes(x));

/** A link step's answer applied to what the page showed: a character newly linked is no longer frozen, and one now frozen is no longer linked. */
export function afterLinks(was: CharacterLinkStatus, r: { linked: string[]; frozen: string[] }, at: string, linkError: string | null): CharacterLinkStatus {
  return { ...was, linked: without(union(was.linked, r.linked), r.frozen), frozen: without(union(was.frozen, r.frozen), r.linked), linkedAt: at, linkError };
}

/**
 * A sync's answer applied to what the page showed: a character the site synced, or holds with its sync off, is linked and
 * no longer frozen; one the account holds no live link for is no longer linked.
 */
export function afterSync(
  was: CharacterLinkStatus,
  r: { synced: string[]; syncOff: string[]; notLinked: string[]; categories: CharacterLinkStatus["categories"] },
  at: string,
  syncError: string | null,
): CharacterLinkStatus {
  const confirmed = [...r.synced, ...r.syncOff];
  const kept = r.synced.length ? { syncedAt: at, synced: r.synced, categories: r.categories } : {};
  return { ...was, ...kept, linked: without(union(was.linked, confirmed), r.notLinked), frozen: without(was.frozen, confirmed), syncError };
}

/**
 * The engine's jobs, built on the companion's own functions so the app sends and writes exactly
 * what the command line does. `current` is read on every run, so a settings change takes effect
 * at the next job without rebuilding anything.
 */
export function companionJobs(dataFolder: string, current: () => Settings): { deps: EngineDeps; lastMarket(): RealmSummary[]; links(active?: readonly string[]): CharacterLinkStatus[]; answerStore: ReturnType<typeof createAnswerStore>; notices: string[] } {
  const notices: string[] = [];
  const recovered = (message: string) => { notices.push(message); };
  const state = createSentState(join(dataFolder, "sent.json"), recovered);
  // Whether the site reads runs and pull summaries, from its last receipt for them; until it does they wait here.
  const collects = createSiteCollects(join(dataFolder, "site-collects.json"), recovered);
  const answerStore = createAnswerStore(join(dataFolder, "answers.json"), recovered);
  const addonsDir = () => join(current().gameFolder ?? "", "Interface", "AddOns");
  const marketScope = (s: Settings) => JSON.stringify([s.gameFolder, s.endpoint]);
  let lastMarket: { scope: string; realms: RealmSummary[] } | undefined;
  // The last link and sync results per account file, for the Characters page, kept while the app runs. Each belongs to the
  // site and account it was sent with (a short hash of the key, never the key): signing in to another account or
  // changing the site drops them, and an answer that arrives after such a change is not kept.
  const links = new Map<string, { scope: string; status: CharacterLinkStatus }>();
  const scopeOf = (endpoint: string) => {
    const key = accountKeyForSite(dataFolder, endpoint);
    return `${endpoint}\n${key ? createHash("sha256").update(key).digest("hex").slice(0, 16) : "-"}`;
  };
  const linkStatus = (file: string, scope: string): CharacterLinkStatus => {
    const kept = links.get(file);
    return kept && kept.scope === scope ? kept.status
      : { file, linked: [], frozen: [], linkedAt: null, linkError: null, syncedAt: null, synced: [], categories: [], syncError: null };
  };
  const keep = (file: string, scope: string, status: CharacterLinkStatus) => {
    if (scopeOf(current().endpoint) === scope) links.set(file, { scope, status });
  };
  const deps: EngineDeps = {
    findFiles: findEverlootFiles,
    async upload(file) {
      const endpoint = current().endpoint;
      const scope = scopeOf(endpoint);
      // Keep local history even when the network is down; a failed backup never blocks upload.
      let backup = "";
      try { backupSavedVariables(file, dataFolder); backup = "; backup kept"; } catch (err) { backup = `; backup failed: ${err instanceof Error ? err.message : String(err)}`; }
      // The settled list is kept beside sent.json and refreshed once a day.
      const settled = (build: string | undefined) => appSettledList({ folder: dataFolder, endpoint, build });
      // Two accounts' files can carry one install id (a copied WTF folder). Their upload history is kept whole while
      // another file has the same id, so neither cuts the other's. After readyFacts this reads the reader's parse; a
      // file that cannot be read or parsed has no id to share.
      const sharesInstall = async (installId: string) => {
        const others = findEverlootFiles(current().gameFolder ?? "").filter((f) => f !== file);
        await readyFacts(others);
        return others.some((f) => { try { return saveFacts(f).upload.installId === installId; } catch { return false; } });
      };
      // The save reader parses the file off the main thread and hands over only the rows still unsent.
      const r = await uploadFile(file, { endpoint, state, census: current().census, players: current().players, pulls: true, collects, settled, read: readForUpload, sharesInstall });
      const runs = r.heldRuns ? `; kept ${r.heldRuns} ${r.heldRuns === 1 ? "run or boss pull" : "runs and boss pulls"} here until the site reads them` : "";
      // A list for a build the game has moved on from is never read again.
      pruneSettledLists(dataFolder);
      const rejected = r.rejected ? `; the site turned away ${r.rejected} ${r.rejected === 1 ? "row, which stays unsent and goes" : "rows, which stay unsent and go"} again next run` : "";
      // Codes typed with /everloot link go to the account's own link endpoint with the account key, never with the
      // upload. A link that fails never fails the upload; its rows go again next run.
      let linked = "";
      try {
        const r = await sendLinks(file, { endpoint, key: accountKeyForSite(dataFolder, endpoint), state });
        const said = linkSummary(r);
        if (said) {
          linked = `; ${said}`;
          // What is left of the summary once the linked and frozen characters are taken out: refused codes, or why codes wait.
          keep(file, scope, afterLinks(linkStatus(file, scope), r, new Date().toISOString(), linkSummary({ ...r, linked: [], frozen: [] })));
        }
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        linked = `; character links not sent: ${why}`;
        keep(file, scope, { ...linkStatus(file, scope), linkedAt: new Date().toISOString(), linkError: `character links not sent: ${why}` });
      }
      // Linked characters' own rows go to the account's sync endpoint with the same key, after the links so a code
      // typed this session is linked first. Each category is kept only where the player turned its sync on.
      let sync = "";
      try {
        const r = await sendSync(file, { endpoint, key: accountKeyForSite(dataFolder, endpoint), state });
        const said = syncSummary(r);
        if (said) {
          sync = `; ${said}`;
          keep(file, scope, afterSync(linkStatus(file, scope), r, new Date().toISOString(), syncSummary({ ...r, synced: [] })));
        }
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        sync = `; characters not synced: ${why}`;
        keep(file, scope, { ...linkStatus(file, scope), syncError: `characters not synced: ${why}` });
      }
      return `sent ${r.sent} new events in ${r.batches} batch(es)${rejected}; skipped ${r.skipped} already settled; kept ${r.heldNamed} named, ${r.heldAddons} installed-addon, ${r.heldCensus} census and ${r.heldLegacy} legacy rows here${runs}${linked}${sync}${backup}`;
    },
    async prices(files) {
      const s = current();
      const scope = marketScope(s);
      const dir = join(s.gameFolder ?? "", "Interface", "AddOns");
      const followed = [...s.market.realms];
      await readyFacts(files);
      const r = await refreshMarket({ svFiles: files, followed, addonsDir: dir, endpoint: s.endpoint });
      if (marketScope(current()) === scope) lastMarket = { scope, realms: r.realms };
      const realms = new Set(r.realms.map((x) => x.realm.toLowerCase())).size;
      return `${r.items} items in ${r.realms.length} auction house(s) on ${realms} realm(s) and ${r.drops} drop sources written; /reload in game to see them`;
    },
    async progress(files, isCurrent) {
      const s = current();
      const dir = addonsDir();
      await readyFacts(files);
      await refreshDungeonProgress({
        realms: characterRealms(files).slice(0, 6),
        endpoint: s.endpoint,
        addonsDir: dir,
        current: () => isCurrent() && current().endpoint === s.endpoint && addonsDir() === dir,
      });
    },
    async ask(file) {
      const s = current();
      // A token file points at a private server; without one, the site's public server answers, with the account key when signed in.
      let mcp: { url: string; token: string | null } = { url: `${s.endpoint}/mcp/public`, token: accountKeyForSite(dataFolder, s.endpoint) };
      if (s.ask.tokenFile) {
        let token: string;
        try { token = readFileSync(s.ask.tokenFile, "utf8").trim(); }
        catch { throw new Error(`token file ${s.ask.tokenFile} could not be read`); }
        if (!token) throw new Error(`token file ${s.ask.tokenFile} is empty`);
        mcp = { url: s.ask.mcpUrl, token };
      }
      // Providers the player enabled in config.json beside sent.json; none means answers from the evidence alone. They are read
      // when a question that is not a price one needs them, so a damaged config.json never blocks a price answer.
      const providers = providersOnDemand(join(dataFolder, "config.json"));
      // A price question is answered from the recorded market first, with no model; the rest follows the providers.
      const engine = withMarket(
        lazyEngine(() => providers().length ? llmEngine({ sources: (q) => mcpAnswerSources(mcp, q, 3), providers: providers() }) : mcpEngine(mcp)),
        { lookup: (realm, id, signal) => mcpMarketValue(mcp, realm, id, signal), resolveItem: siteItemSearch(s.endpoint), realmChoices: s.market.realms },
      );
      await readyFacts([file]);
      const r = await answerPending({ svFile: file, asks: saveFacts(file).asks, addonsDir: addonsDir(), engine, store: answerStore });
      let how: string;
      try { how = providers().length ? providers().map((p) => p.name).join(" > ") : "plain search"; }
      catch (err) { how = `config.json: ${err instanceof Error ? err.message : String(err)}`; }
      return r.answered || r.failed ? `answered ${r.answered}, failed ${r.failed} (${how}); /reload in game to read them` : `nothing pending (${how})`;
    },
    // The jobs wait a few seconds for the write to settle; the save reader starts on it at once, so its facts are
    // usually ready before they run.
    watch: (file, onChange) => watchFile(file, () => { void readyFacts([file]); onChange(); }),
  };
  // The results the page shows: this site's and account's only, and, given the files the app watches now, only theirs.
  // Anything else is dropped, so results for a file or account no longer in use never pile up.
  const visibleLinks = (active?: readonly string[]) => {
    const scope = scopeOf(current().endpoint);
    for (const [file, kept] of links) if (kept.scope !== scope || (active && !active.includes(file))) links.delete(file);
    return [...links.values()].map((kept) => kept.status);
  };
  return {
    deps, links: visibleLinks, answerStore, notices,
    lastMarket: () => lastMarket?.scope === marketScope(current()) ? lastMarket.realms : [],
  };
}
