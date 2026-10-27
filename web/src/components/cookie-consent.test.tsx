// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CookieConsent from "./CookieConsent";

const GA = "G-ABCD1234";
const CF = "0123456789abcdef0123456789abcdef";
let container: HTMLDivElement;
let root: Root;
// jsdom has no layout, so the banner's size changes are fed in by hand.
let resized: (() => void) | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class {
    constructor(callback: () => void) { resized = callback; }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  localStorage.clear();
  sessionStorage.clear();
  document.head.innerHTML = "";
  document.documentElement.style.scrollPaddingBottom = "";
  window.history.replaceState(null, "", "/");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const button = (label: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === label)!;
const scripts = () => Array.from(document.head.querySelectorAll("script"));
const checkboxes = () => Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
const reopen = () => act(async () => window.dispatchEvent(new Event("everloot:cookie-preferences")));
const remount = async (element: ReactElement) => {
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(element));
};
const blockStorage = () => {
  for (const method of ["getItem", "setItem", "removeItem"] as const) {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
  }
};
// Chrome with cookies blocked throws on reading window.localStorage itself. Returns the undo.
const denyStorage = () => {
  const own = (["localStorage", "sessionStorage"] as const).map((name) => [name, Object.getOwnPropertyDescriptor(window, name)] as const);
  for (const [name] of own) {
    Object.defineProperty(window, name, { configurable: true, get() { throw new DOMException("Access is denied for this document.", "SecurityError"); } });
  }
  return () => {
    for (const [name, descriptor] of own) {
      if (descriptor) Object.defineProperty(window, name, descriptor);
      else delete (window as unknown as Record<string, unknown>)[name];
    }
  };
};

describe("compact consent", () => {
  it("opens with a short notice, Reject and Accept in the same pill, and Choices; the categories wait", async () => {
    await act(async () => root.render(<CookieConsent analytics={{ gaId: GA }} />));
    const labels = Array.from(container.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toEqual(["Reject optional cookies", "Accept optional cookies", "Choices"]);
    expect(button("Reject optional cookies").className).toBe(button("Accept optional cookies").className);
    expect(button("Choices").getAttribute("aria-expanded")).toBe("false");
    expect(checkboxes()).toHaveLength(0);
    expect(container.querySelectorAll("p")).toHaveLength(1);
    // Before anyone accepts, the banner says the choice can be changed later.
    expect(container.textContent).toContain("You can change your choice in the footer.");
  });

  it("rejects in one action: nothing loads, the choice is stored and the banner closes", async () => {
    await act(async () => root.render(<CookieConsent analytics={{ gaId: GA, metricoolHash: "424c5c3857a5c9d4bfab8635880f0e69" }} />));
    await act(async () => button("Reject optional cookies").click());
    expect(scripts()).toHaveLength(0);
    expect(localStorage.getItem("everloot-analytics-consent-v1")).toBe("rejected");
    expect(container.querySelector("section")).toBeNull();
  });

  it("opens the categories unticked under Choices, and saving them untouched rejects", async () => {
    await act(async () => root.render(<CookieConsent analytics={{ gaId: GA }} />));
    await act(async () => button("Choices").click());
    expect(button("Choices").getAttribute("aria-expanded")).toBe("true");
    expect(checkboxes().map((c) => c.checked)).toEqual([false]);
    await act(async () => button("Save my choices").click());
    expect(localStorage.getItem("everloot-analytics-consent-v1")).toBe("rejected");
    expect(scripts()).toHaveLength(0);
  });

  it("lets Choices accept a category on its own", async () => {
    await act(async () => root.render(<CookieConsent analytics={{ gaId: GA }} />));
    await act(async () => button("Choices").click());
    await act(async () => checkboxes()[0].click());
    await act(async () => button("Save my choices").click());
    expect(localStorage.getItem("everloot-analytics-consent-v1")).toBe("accepted");
    expect(scripts().some((s) => s.src.includes("googletagmanager.com"))).toBe(true);
  });

  it("reopens from the footer with the categories open and focus on the heading; Escape closes and gives focus back", async () => {
    localStorage.setItem("everloot-analytics-consent-v1", "rejected");
    const footerButton = document.createElement("button");
    document.body.append(footerButton);
    await act(async () => root.render(<CookieConsent analytics={{ gaId: GA }} />));
    expect(container.querySelector("section")).toBeNull();
    footerButton.focus();
    await reopen();
    expect(document.activeElement).toBe(container.querySelector("#cookie-heading"));
    expect(checkboxes().map((c) => c.checked)).toEqual([false]);
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector("section")).toBeNull();
    expect(document.activeElement).toBe(footerButton);
    footerButton.remove();
  });

  const dismiss = (how: "Escape" | "Close") => act(async () => {
    if (how === "Close") button("Close").click();
    else checkboxes()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

  it.each(["Escape", "Close"] as const)("forgets a tick dismissed with %s: reopened, the box shows the saved rejection and Save keeps it", async (how) => {
    localStorage.setItem("everloot-analytics-consent-v1", "rejected");
    await act(async () => root.render(<CookieConsent analytics={{ gaId: GA }} />));
    await reopen();
    await act(async () => checkboxes()[0].click());
    await dismiss(how);
    expect(container.querySelector("section")).toBeNull();
    expect(localStorage.getItem("everloot-analytics-consent-v1")).toBe("rejected");
    await reopen();
    expect(checkboxes().map((c) => c.checked)).toEqual([false]);
    await act(async () => button("Save my choices").click());
    expect(localStorage.getItem("everloot-analytics-consent-v1")).toBe("rejected");
    expect(scripts()).toHaveLength(0);
  });

  it.each(["Escape", "Close"] as const)("keeps a saved acceptance when an untick is dismissed with %s", async (how) => {
    localStorage.setItem("everloot-analytics-consent-v1", "accepted");
    await act(async () => root.render(<CookieConsent analytics={{ gaId: GA }} />));
    await reopen();
    await act(async () => checkboxes()[0].click());
    await dismiss(how);
    await reopen();
    expect(checkboxes().map((c) => c.checked)).toEqual([true]);
    expect(localStorage.getItem("everloot-analytics-consent-v1")).toBe("accepted");
    expect(scripts().some((s) => s.src.includes("googletagmanager.com"))).toBe(true);
  });

  it("shows an earlier one-action acceptance as ticked when reopened, so saving keeps it", async () => {
    await act(async () => root.render(<CookieConsent analytics={{ gaId: GA }} />));
    await act(async () => button("Accept optional cookies").click());
    await reopen();
    expect(checkboxes().map((c) => c.checked)).toEqual([true]);
    await act(async () => button("Save my choices").click());
    expect(localStorage.getItem("everloot-analytics-consent-v1")).toBe("accepted");
    expect(scripts().some((s) => s.src.includes("googletagmanager.com"))).toBe(true);
  });

  it("unloads analytics when an acceptance is withdrawn", async () => {
    await act(async () => root.render(<CookieConsent analytics={{ gaId: GA }} />));
    await act(async () => button("Accept optional cookies").click());
    expect(scripts().some((s) => s.src.includes("googletagmanager.com"))).toBe(true);
    await reopen();
    // The withdrawal also reloads the page; jsdom prints that it cannot ("Not implemented: navigation").
    await act(async () => button("Reject optional cookies").click());
    expect(scripts()).toHaveLength(0);
    expect(window.gtag).toBeUndefined();
    expect(localStorage.getItem("everloot-analytics-consent-v1")).toBe("rejected");
  });

  it("keeps a rejection beside a talent #plan= when every storage write is blocked, and still reads it after a reload", async () => {
    window.history.replaceState(null, "", "/tools/talents/warrior#plan=EL1abc&plan2=EL1def");
    blockStorage();
    await act(async () => root.render(<CookieConsent analytics={{ gaId: GA }} />));
    await act(async () => button("Reject optional cookies").click());
    expect(window.location.pathname).toBe("/tools/talents/warrior");
    expect(window.location.hash).toBe("#plan=EL1abc&plan2=EL1def&everloot-analytics-rejected");
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/could not save/);
    expect(scripts()).toHaveLength(0);
    await remount(<CookieConsent analytics={{ gaId: GA }} />);
    expect(scripts()).toHaveLength(0);
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/remain rejected/);
  });

  it("still asks, and keeps a rejection beside the #plan=, when the browser refuses storage outright", async () => {
    window.history.replaceState(null, "", "/tools/talents/warrior#plan=EL1abc");
    const undo = denyStorage();
    try {
      await act(async () => root.render(<CookieConsent analytics={{ gaId: GA }} />));
      expect(container.querySelector("section")).not.toBeNull();
      await act(async () => button("Reject optional cookies").click());
      expect(window.location.hash).toBe("#plan=EL1abc&everloot-analytics-rejected");
      expect(scripts()).toHaveLength(0);
      await remount(<CookieConsent analytics={{ gaId: GA }} />);
      expect(container.querySelector('[role="status"]')?.textContent).toMatch(/remain rejected/);
      expect(scripts()).toHaveLength(0);
    } finally {
      await act(async () => root.unmount());
      undo();
      root = createRoot(container);
    }
  });

  it("takes only the rejection back out of the address when the visitor then accepts", async () => {
    window.history.replaceState(null, "", "/tools/talents/warrior#plan=EL1abc&everloot-analytics-rejected");
    blockStorage();
    await act(async () => root.render(<CookieConsent analytics={{ gaId: GA }} />));
    expect(scripts()).toHaveLength(0);
    await act(async () => button("Accept optional cookies").click());
    expect(window.location.hash).toBe("#plan=EL1abc");
    expect(scripts().some((s) => s.src.includes("googletagmanager.com"))).toBe(true);
  });

  it("keeps the cookieless beacon off under GPC, before and after a rejection", async () => {
    Object.defineProperty(navigator, "globalPrivacyControl", { value: true, configurable: true });
    try {
      await act(async () => root.render(<CookieConsent analytics={{ gaId: GA, cfBeaconToken: CF }} />));
      expect(scripts()).toHaveLength(0);
      await act(async () => button("Reject optional cookies").click());
      expect(scripts()).toHaveLength(0);
    } finally {
      delete (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl;
    }
  });

  it("keeps a focused control scrolled clear of the banner while it is open, then gives the page its padding back", async () => {
    document.documentElement.style.scrollPaddingBottom = "12px";
    document.body.style.paddingBottom = "4px";
    try {
      await act(async () => root.render(<CookieConsent analytics={{ gaId: GA }} />));
      const banner = container.querySelector("section")!;
      // jsdom has no stylesheet, so bottom-4's inset and the banner's height are given by hand.
      banner.style.bottom = "16px";
      banner.getBoundingClientRect = () => ({ top: 600, height: 114 }) as DOMRect;
      resized!();
      expect(document.documentElement.style.scrollPaddingBottom).toBe("138px");
      // The last controls on the page need room below them to scroll clear of it too.
      expect(document.body.style.paddingBottom).toBe("138px");
      banner.getBoundingClientRect = () => ({ top: 430, height: 284 }) as DOMRect;
      resized!();
      expect(document.documentElement.style.scrollPaddingBottom).toBe("308px");
      expect(document.body.style.paddingBottom).toBe("308px");
      // A larger root font makes the 1rem inset larger, and the padding follows it.
      banner.style.bottom = "32px";
      resized!();
      expect(document.documentElement.style.scrollPaddingBottom).toBe("324px");
      await act(async () => button("Reject optional cookies").click());
      expect(document.documentElement.style.scrollPaddingBottom).toBe("12px");
      expect(document.body.style.paddingBottom).toBe("4px");
    } finally {
      document.body.style.paddingBottom = "";
    }
  });

  it("covers the same strip whatever the window measures say: a desktop scrollbar, a phone toolbar shown or hidden", async () => {
    await act(async () => root.render(<CookieConsent analytics={{ gaId: GA }} />));
    const banner = container.querySelector("section")!;
    banner.style.bottom = "16px";
    const innerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
    // The banner sits 16 px above the bottom it follows and is 114 px tall in every case; only the window changes.
    const windows = [
      { case: "measures agree", inner: 768, client: 768, followedBottom: 768 },
      { case: "desktop scrollbar along the bottom", inner: 768, client: 753, followedBottom: 753 },
      { case: "phone toolbar hidden after layout", inner: 824, client: 768, followedBottom: 824 },
    ];
    try {
      for (const w of windows) {
        Object.defineProperty(window, "innerHeight", { configurable: true, value: w.inner });
        Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: w.client });
        banner.getBoundingClientRect = () => ({ top: w.followedBottom - 16 - 114, height: 114 }) as DOMRect;
        resized!();
        expect(document.documentElement.style.scrollPaddingBottom, w.case).toBe("138px");
        expect(document.body.style.paddingBottom, w.case).toBe("138px");
      }
    } finally {
      if (innerHeight) Object.defineProperty(window, "innerHeight", innerHeight);
      delete (document.documentElement as unknown as { clientHeight?: number }).clientHeight;
      document.body.style.paddingBottom = "";
    }
  });

  it("stops a banner grown by zoom 5rem short of the window top, so a focused control fits above it, and scrolls inside", async () => {
    await act(async () => root.render(<CookieConsent analytics={{ gaId: GA }} />));
    const banner = container.querySelector("section")!;
    expect(banner.className).toContain("overflow-y-auto");
    // With bottom-4 that leaves 5rem above it: a 2.75rem control, its focus ring and a desktop scrollbar.
    expect(banner.className).toContain("max-h-[calc(100dvh-6rem)]");
  });
});

describe("CookieConsent categories", () => {
  it("keeps Metricool off before consent and after rejection, and loads it after acceptance", async () => {
    await act(async () => root.render(<CookieConsent analytics={{ metricoolHash: "424c5c3857a5c9d4bfab8635880f0e69" }} />));
    expect(scripts()).toHaveLength(0);
    expect(container.textContent).toContain("Optional analytics loads only if you accept.");
    await act(async () => button("Reject optional cookies").click());
    expect(scripts()).toHaveLength(0);
    await act(async () => window.dispatchEvent(new Event("everloot:cookie-preferences")));
    await act(async () => button("Accept optional cookies").click());
    expect(scripts().map((s) => s.src)).toEqual(["https://tracker.metricool.com/resources/be.js"]);
  });
  it("loads no script and shows no banner when nothing is configured", async () => {
    await act(async () => root.render(<CookieConsent />));
    expect(scripts()).toHaveLength(0);
    expect(container.querySelector("section")).toBeNull();
  });

  it("does not load Google Analytics before consent, and loads it after acceptance", async () => {
    await act(async () => root.render(<CookieConsent analytics={{ gaId: GA }} />));
    expect(scripts()).toHaveLength(0);
    expect(container.textContent).toContain("Optional analytics loads only if you accept.");
    expect(container.textContent).not.toMatch(/advertising loads/i);
    await act(async () => button("Accept optional cookies").click());
    expect(scripts().some((s) => s.src.includes("googletagmanager.com"))).toBe(true);
    expect(localStorage.getItem("everloot-analytics-consent-v1")).toBe("accepted");
  });

  it("keeps Google Analytics off after rejection", async () => {
    await act(async () => root.render(<CookieConsent analytics={{ gaId: GA }} />));
    await act(async () => button("Reject optional cookies").click());
    expect(scripts()).toHaveLength(0);
    expect(localStorage.getItem("everloot-analytics-consent-v1")).toBe("rejected");
  });

  it("keeps the cookieless beacon free of any banner or choice", async () => {
    await act(async () => root.render(<CookieConsent analytics={{ cfBeaconToken: CF }} />));
    expect(scripts().map((s) => s.src)).toEqual(["https://static.cloudflareinsights.com/beacon.min.js"]);
    expect(container.querySelector("section")).toBeNull();
  });

  it("does not offer advertising unless an AdSense client is set", async () => {
    await act(async () => root.render(<CookieConsent analytics={{ gaId: GA }} />));
    await act(async () => button("Choices").click());
    expect(container.textContent).toContain("Analytics.");
    expect(container.textContent).not.toContain("Google AdSense");
  });

  it("does not read an old advertising choice as analytics consent, and asks only once", async () => {
    localStorage.setItem("gg-cookie-consent-v1", "accepted");
    await act(async () => root.render(<CookieConsent analytics={{ gaId: GA }} />));
    expect(scripts()).toHaveLength(0);
    expect(container.querySelector("section")).not.toBeNull();
    await act(async () => button("Reject optional cookies").click());
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<CookieConsent analytics={{ gaId: GA }} />));
    expect(container.querySelector("section")).toBeNull();
  });

  it("never claims the site runs no ads: AdSense consent is Google's message, not this banner", async () => {
    await act(async () => root.render(<CookieConsent analytics={{ gaId: GA }} />));
    await act(async () => button("Choices").click());
    expect(container.textContent).not.toContain("does not run ads");
    expect(container.textContent).not.toContain("Advertising.");
  });
});
