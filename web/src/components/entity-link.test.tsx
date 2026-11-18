import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, prefetch }: { href: string; children: ReactNode; prefetch?: boolean }) => <a href={href} data-prefetch={String(prefetch)}>{children}</a>,
}));

import EntityLink from "./EntityLink";

test.each(["spell", "vendor"] as const)("a %s EntityLink targets the page recognized by hover cards", (kind) => {
  const html = renderToStaticMarkup(<EntityLink kind={kind} id={10} name="Shown name" />);
  expect(html).toContain(`href="/database/${kind}s/10"`);
  expect(html).toContain("Shown name");
  expect(html).not.toContain("data-no-hover-card");
});

test("an EntityLink is not prefetched as the page loads unless the caller asks for it", () => {
  expect(renderToStaticMarkup(<EntityLink kind="item" id={10} name="Shown name" />)).toContain('data-prefetch="false"');
  expect(renderToStaticMarkup(<EntityLink kind="item" id={10} name="Shown name" prefetch />)).toContain('data-prefetch="true"');
});
