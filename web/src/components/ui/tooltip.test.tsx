// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import Tooltip from "./Tooltip";

test("metric explanations are named, described, focusable and dismiss with Escape", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Tooltip label="Gear Score weights item levels by slot. Read Nov 17.">61.2</Tooltip>));
    const button = host.querySelector("button")!;
    expect(button.type).toBe("button");
    expect(button.getAttribute("aria-label")).toContain("Gear Score");
    expect(document.getElementById(button.getAttribute("aria-describedby")!)?.textContent).toContain("Read Nov 17");
    await act(async () => button.focus());
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("Read Nov 17");
    await act(async () => button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(document.activeElement).toBe(button);
    await act(async () => { button.blur(); button.focus(); });
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    await act(async () => button.blur());
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
