// @vitest-environment jsdom
import { act, Component, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

import DatabaseUnavailable from "./database/error";
import ToolUnavailable from "./tools/error";

type Fallback = ComponentType<{ error: Error & { digest?: string }; reset: () => void }>;

// What Next does with a segment's error.tsx: catch the throw below it, render the file with `reset`, and render the
// segment again when `reset` is called.
class Boundary extends Component<{ fallback: Fallback; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    const Fallback = this.props.fallback;
    if (this.state.error) return <Fallback error={this.state.error} reset={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

for (const [name, fallback, title] of [
  ["database", DatabaseUnavailable, "Database unavailable"],
  ["tools", ToolUnavailable, "Tool unavailable"],
] as const) {
  test(`a failed read under ${name} shows its section page, and Try again renders the page once the read works`, () => {
    let readFails = true;
    function Page() {
      if (readFails) throw new Error("storage could not be read");
      return <p>the page</p>;
    }
    act(() => root.render(<Boundary fallback={fallback}><Page /></Boundary>));
    expect(container.textContent).toContain(title);
    expect(container.textContent).not.toContain("the page");

    readFails = false;
    const retry = [...container.querySelectorAll("button")].find((b) => b.textContent === "Try again");
    expect(retry).toBeDefined();
    act(() => retry!.click());
    expect(container.textContent).toContain("the page");
    expect(container.textContent).not.toContain(title);
  });
}
