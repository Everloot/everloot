// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import ConversationRail from "./ConversationRail";

test("the browser-only phone rail has a visible Close control even while an answer runs", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const close = vi.fn();
  try {
    await act(async () => root.render(<ConversationRail conversations={[]} currentId="new" busy onNew={() => {}} onOpen={() => {}} onDelete={() => {}} onClose={close} />));
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Close conversations"]');
    expect(button?.textContent).toBe("Close");
    expect(button?.className).toContain("lg:hidden");
    expect(button?.disabled).toBe(false);
    await act(async () => button!.click());
    expect(close).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
