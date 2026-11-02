import { readFileSync } from "node:fs";
import { join } from "node:path";
import { answerPending, createAnswerStore } from "../../../companion/src/bridge/run";
import { lazyEngine, mcpAnswerSources, mcpEngine, mcpMarketValue, siteItemSearch, withMarket } from "../../../companion/src/bridge/engine";
import { llmEngine } from "../../../companion/src/bridge/llm-engine";
import { providersOnDemand } from "../../../companion/src/providers/config";
import { linkSummary, sendLinks } from "../../../companion/src/link-sender";
import { findEverlootFiles } from "../../../companion/src/savedvariables";
import { createSentState } from "../../../companion/src/sent-state";
import { uploadFile } from "../../../companion/src/uploader";
import { watchFile } from "../../../companion/src/watch-file";
import { appSettledList } from "../../../web/src/lib/settled-cache";
import type { RealmSummary, Settings } from "../shared/types";
import { accountKeyForSite } from "./account";
import { backupSavedVariables } from "./backups";
import type { EngineDeps } from "./engine";
import { refreshMarket } from "./market";
import { saveFacts } from "./save-facts";

/**
 * The engine's jobs, built on the companion's own functions so the app sends and writes exactly
 * what the command line does. `current` is read on every run, so a settings change takes effect
 * at the next job without rebuilding anything.
 */
export function companionJobs(dataFolder: string, current: () => Settings): { deps: EngineDeps; lastMarket(): RealmSummary[]; answerStore: ReturnType<typeof createAnswerStore>; notices: string[] } {
  const notices: string[] = [];
  const recovered = (message: string) => { notices.push(message); };
  const state = createSentState(join(dataFolder, "sent.json"), recovered);
  const answerStore = createAnswerStore(join(dataFolder, "answers.json"), recovered);
  const addonsDir = () => join(current().gameFolder ?? "", "Interface", "AddOns");
  let lastMarket: RealmSummary[] = [];
  const deps: EngineDeps = {
    findFiles: findEverlootFiles,
    async upload(file) {
      const endpoint = current().endpoint;
      // Keep local history even when the network is down; a failed backup never blocks upload.
      let backup = "";
      try { backupSavedVariables(file, dataFolder); backup = "; backup kept"; } catch (err) { backup = `; backup failed: ${err instanceof Error ? err.message : String(err)}`; }
      // The settled list is kept beside sent.json and refreshed once a day.
      const settled = (build: string | undefined) => appSettledList({ folder: dataFolder, endpoint, build });
      const r = await uploadFile(file, { endpoint, state, census: current().census, players: current().players, settled });
      const rejected = r.rejected ? `; the site turned away ${r.rejected} ${r.rejected === 1 ? "row, which stays unsent and goes" : "rows, which stay unsent and go"} again next run` : "";
      // Codes typed with /everloot link go to the account's own link endpoint with the account key, never with the
      // upload. A link that fails never fails the upload; its rows go again next run.
      let links = "";
      try {
        const said = linkSummary(await sendLinks(file, { endpoint, key: accountKeyForSite(dataFolder, endpoint), state }));
        if (said) links = `; ${said}`;
      } catch (err) { links = `; character links not sent: ${err instanceof Error ? err.message : String(err)}`; }
      return `sent ${r.sent} new events in ${r.batches} batch(es)${rejected}; skipped ${r.skipped} already settled; kept ${r.heldNamed} named, ${r.heldAddons} installed-addon, ${r.heldCensus} census and ${r.heldLegacy} legacy rows here${links}${backup}`;
    },
    async prices(files) {
      const s = current();
      const r = await refreshMarket({ svFiles: files, followed: s.market.realms, addonsDir: addonsDir(), endpoint: s.endpoint });
      lastMarket = r.realms;
      return `${r.items} items on ${r.realms.length} realm(s) and ${r.drops} drop sources written; /reload in game to see them`;
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
      const r = await answerPending({ svFile: file, asks: saveFacts(file).asks, addonsDir: addonsDir(), engine, store: answerStore });
      let how: string;
      try { how = providers().length ? providers().map((p) => p.name).join(" > ") : "plain search"; }
      catch (err) { how = `config.json: ${err instanceof Error ? err.message : String(err)}`; }
      return r.answered || r.failed ? `answered ${r.answered}, failed ${r.failed} (${how}); /reload in game to read them` : `nothing pending (${how})`;
    },
    watch: (file, onChange) => watchFile(file, onChange),
  };
  return { deps, lastMarket: () => lastMarket, answerStore, notices };
}
