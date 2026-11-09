import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { BLIZZARD_CREDIT } from "@/lib/armory";
import { STORAGE_UNREACHABLE } from "@/lib/upload-store";

// The real store module, not a stand-in: production with the armory on but no service key. The factory gives no
// store, and every page must still answer, saying storage is out of reach, with the forms still drawn.

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  usePathname: () => "/armory", useRouter: () => ({ push: () => {} }), useSearchParams: () => new URLSearchParams(),
}));

const held = globalThis as { __everlootArmory?: unknown; __everlootArmoryLogged?: boolean };
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  delete held.__everlootArmory;
  delete held.__everlootArmoryLogged;
  log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
});
afterEach(() => { delete held.__everlootArmory; delete held.__everlootArmoryLogged; vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules(); });

test("with no store the hub, a board and both forms render the unreachable line, the credit and the forms", async () => {
  const hub = renderToStaticMarkup(await (await import("./page")).default({ searchParams: Promise.resolve({ q: "vel" }) }));
  const board = renderToStaticMarkup(await (await import("./rankings/[metric]/page")).default({ params: Promise.resolve({ metric: "item-level" }), searchParams: Promise.resolve({}) }));
  const hide = renderToStaticMarkup(await (await import("./hide/page")).default({ searchParams: Promise.resolve({}) }));
  const submit = renderToStaticMarkup(await (await import("./submit/page")).default({ searchParams: Promise.resolve({}) }));
  for (const out of [hub, board, hide, submit]) {
    expect(out).toContain(STORAGE_UNREACHABLE);
    expect(out).toContain(BLIZZARD_CREDIT);
    expect(out).toContain("Read time unrecorded");
  }
  expect(hide).toContain('action="/armory/hide/send"');
  // Four pages, one line in the log, naming the variables and nothing else.
  expect(log).toHaveBeenCalledTimes(1);
  expect(String(log.mock.calls[0]![0])).toContain("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
  expect(submit).toContain('action="/armory/submit/send"');
});

test("the character and guild pages say so too", async () => {
  const character = renderToStaticMarkup(await (await import("./[region]/[slug]/page")).default({ params: Promise.resolve({ region: "eu", slug: "velkara-duskmantle" }) }));
  const guild = renderToStaticMarkup(await (await import("./[region]/guilds/[slug]/page")).default({ params: Promise.resolve({ region: "eu", slug: "wardens" }) }));
  for (const out of [character, guild]) {
    expect(out).toContain(STORAGE_UNREACHABLE);
    expect(out).toContain(BLIZZARD_CREDIT);
  }
});
