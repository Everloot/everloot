// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { GuideMarketControls, useGuideMarket } from "./leveling-guide-market";

const houses = { "Forever PvE": ["Horde"], "Forever PvP": ["Alliance", "Horde"] };
const ids = [11];
const endpoint = (input: string) => new URL(input, "https://everloot.test").searchParams;
const response = (body: unknown) => ({ ok: true, json: async () => body });
const quote = (cost: number) => response({ ok: true, items: [[11, cost, cost]] });

function Controls({ realm = "", house = "" }: { realm?: string; house?: string }) {
  const market = useGuideMarket(ids, { realm, house });
  return <><GuideMarketControls state={market} /><output>{market.market?.quotes.get(11)?.[2] ?? "Unpriced"}</output></>;
}

async function withPicker(run: (context: {
  host: HTMLElement;
  render: (key: string, realm?: string, house?: string) => Promise<void>;
  change: (index: number, value: string) => Promise<void>;
}) => Promise<void>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await run({
      host,
      render: async (key, realm, house) => { await act(async () => root.render(<Controls key={key} realm={realm} house={house} />)); },
      change: async (index, value) => {
        const picker = host.querySelectorAll("select")[index]!;
        await act(async () => {
          picker.value = value;
          picker.dispatchEvent(new Event("change", { bubbles: true }));
        });
      },
    });
  } finally {
    await act(async () => root.unmount());
    window.localStorage.clear();
    vi.unstubAllGlobals();
  }
}

test("discovers houses on open, remembers the chosen house and gives a shared URL precedence", async () => {
  const fetcher = vi.fn(async (input: string) => {
    const house = endpoint(input).get("house");
    return house ? quote(house === "Horde" ? 70 : 30) : response({ houses });
  });
  await withPicker(async ({ host, render, change }) => {
    vi.stubGlobal("fetch", fetcher);
    await render("new");
    expect(host.querySelectorAll("select")).toHaveLength(1);
    expect(fetcher.mock.calls.map(([url]) => endpoint(url).get("house"))).toEqual([null]);
    expect(host.querySelector("button")).toBeNull();

    await change(0, "Forever PvE");
    expect(host.querySelector("output")?.textContent).toBe("70");
    await render("next-guide");
    expect(host.querySelector("select")?.value).toBe("Forever PvE");
    expect(host.querySelector("output")?.textContent).toBe("70");

    await render("from-link", "forever-pvp", "alliance");
    expect(host.querySelector("select")?.value).toBe("Forever PvP");
    expect(host.querySelectorAll("select")[1]?.value).toBe("Alliance");
    expect(host.querySelector("output")?.textContent).toBe("30");
    await render("new-visit");
    expect(host.querySelector("select")?.value).toBe("Forever PvE");
    expect(host.querySelector("output")?.textContent).toBe("70");
  });
});

test("waits for a faction choice and ignores results from a cleared or superseded selection", async () => {
  const pending = new Map<string, { signal: AbortSignal | null | undefined; complete: (data: ReturnType<typeof quote>) => void }>();
  const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
    const house = endpoint(input).get("house");
    if (!house) return response({ houses });
    return new Promise<ReturnType<typeof quote>>(complete => pending.set(house, { signal: init?.signal, complete }));
  });
  await withPicker(async ({ host, render, change }) => {
    vi.stubGlobal("fetch", fetcher);
    await render("new");
    await change(0, "Forever PvP");
    expect(pending.size).toBe(0);
    await change(1, "Alliance");
    await change(1, "Horde");
    expect(pending.get("Alliance")?.signal?.aborted).toBe(true);
    await act(async () => pending.get("Alliance")?.complete(quote(30)));
    expect(host.querySelector("output")?.textContent).toBe("Unpriced");

    await change(0, "");
    expect(pending.get("Horde")?.signal?.aborted).toBe(true);
    await act(async () => pending.get("Horde")?.complete(quote(70)));
    expect(host.querySelector("output")?.textContent).toBe("Unpriced");
    await render("reopened");
    expect(host.querySelector("select")?.value).toBe("");
    expect(host.querySelectorAll("select")).toHaveLength(1);
  });
});
