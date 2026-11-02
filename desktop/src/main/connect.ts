import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { desktopKeyPair, openSealed } from "../../../web/src/lib/desktop-connect";

/** How long the app waits for the browser before giving up. */
export const CONNECT_TIMEOUT_MS = 5 * 60_000;

const page = (title: string, text: string) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:16px system-ui;background:#141210;color:#eee;display:grid;place-items:center;height:90vh;margin:0"><div style="max-width:28rem;text-align:center"><h1 style="font-size:1.4rem">${title}</h1><p>${text}</p></div></body>`;

/**
 * Signs the app in through the browser: listens on 127.0.0.1 on a free port, opens everloot.app's connect page
 * with a one-time public key and a state, and waits for the browser to come back with the sealed key. Resolves
 * with the key, already opened; rejects when the player cancels (in the browser or through `signal`), the wait
 * runs out or anything does not match.
 * The key is then checked and kept by `signIn`, as a pasted one is.
 */
export async function connectInBrowser(endpoint: string, open: (url: string) => void, timeoutMs = CONNECT_TIMEOUT_MS, signal?: AbortSignal): Promise<string> {
  const { privateKey, pub, state } = await desktopKeyPair();
  // A cancel that came while the key pair was being made must still stop this wait.
  if (signal?.aborted) throw new Error("Sign-in was cancelled.");
  let server: Server | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Sign-in timed out. Press Sign in to try again.")), timeoutMs);
      const finish = (fn: () => void) => { clearTimeout(timer); fn(); };
      signal?.addEventListener("abort", () => finish(() => reject(new Error("Sign-in was cancelled."))), { once: true });
      server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/callback" || url.searchParams.get("state") !== state) {
          res.writeHead(404, { "content-type": "text/html; charset=utf-8" }).end(page("Not found", "This address only answers the Everloot app's sign-in."));
          return;
        }
        if (url.searchParams.get("error") === "denied") {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page("Sign-in cancelled", "Nothing was made. You can close this tab."));
          finish(() => reject(new Error("Sign-in was cancelled in the browser.")));
          return;
        }
        openSealed({ epk: url.searchParams.get("epk"), iv: url.searchParams.get("iv"), ct: url.searchParams.get("ct") }, privateKey, state).then(
          (key) => {
            res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page("Everloot is signed in", "You can close this tab and go back to the app."));
            finish(() => resolve(key));
          },
          () => {
            res.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(page("Sign-in failed", "The answer could not be read. Press Sign in in the app to try again."));
            finish(() => reject(new Error("The browser's answer could not be read. Try again.")));
          },
        );
      });
      server.on("error", (err) => finish(() => reject(err)));
      server.listen(0, "127.0.0.1", () => {
        const { port } = server!.address() as AddressInfo;
        open(`${endpoint.replace(/\/$/, "")}/desktop/connect?port=${port}&state=${state}&pub=${pub}`);
      });
    });
  } finally {
    // Stop listening now; let the browser's open connection finish receiving its page before it is cut.
    server?.close();
    const open = server;
    setTimeout(() => open?.closeAllConnections?.(), 1000).unref?.();
  }
}
