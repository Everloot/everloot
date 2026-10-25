import { PROVIDERS } from "./store";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

/** Move the old browser-wide credentials only after their tab-local replacement can be saved. */
export function providerSession(persistent: Storage, tab: Storage): Storage {
  const remembered = persistent.getItem(PROVIDERS);
  if (remembered !== null) {
    if (tab.getItem(PROVIDERS) === null) tab.setItem(PROVIDERS, remembered);
    persistent.removeItem(PROVIDERS);
  }
  return tab;
}

/** Called only inside the key-page document boundary. Conversation history stays in localStorage. */
export function providerStorage(): Storage {
  return providerSession(window.localStorage, window.sessionStorage);
}
