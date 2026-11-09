import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import SiteError from "./error";
import GlobalError from "./global-error";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

// Neither boundary uses hooks, so calling it returns its element tree; find the retry button in it.
function findButton(node: ReactNode): ReactElement<{ onClick?: () => void }> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) return node.map(findButton).find(Boolean) ?? null;
  const el = node as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
  if (el.type === "button") return el;
  if (typeof el.type === "function") return findButton((el.type as (p: unknown) => ReactNode)(el.props));
  return findButton(el.props?.children);
}

test("the site error boundary shows the heading, a retry that calls reset, and a link home", () => {
  const reset = vi.fn();
  const html = renderToStaticMarkup(<SiteError error={new Error("x")} reset={reset} />);
  expect(html).toContain("Something went wrong");
  expect(html).toContain("Try again");
  expect(html).toContain('href="/"');
  findButton(SiteError({ error: new Error("x"), reset }))?.props.onClick?.();
  expect(reset).toHaveBeenCalledTimes(1);
});

test("the global error boundary renders its own html shell with a retry and a link home", () => {
  const reset = vi.fn();
  const html = renderToStaticMarkup(<GlobalError error={new Error("x")} reset={reset} />);
  expect(html.startsWith("<html lang=\"en\"><head></head><body")).toBe(true);
  expect(html).toContain("Something went wrong");
  expect(html).toContain('href="/"');
  findButton(GlobalError({ error: new Error("x"), reset }))?.props.onClick?.();
  expect(reset).toHaveBeenCalledTimes(1);
});
