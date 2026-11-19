import { expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); } }));

import AccountPage from "./page";

test("/account sends to /settings; the browser keeps the #fragment, so /account#keys lands on the keys section", async () => {
  await expect(AccountPage({})).rejects.toThrow(/^NEXT_REDIRECT \/settings$/);
  await expect(AccountPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(/^NEXT_REDIRECT \/settings$/);
});

test("a social link's linkError comes along, so the failure is still said on /settings", async () => {
  await expect(AccountPage({ searchParams: Promise.resolve({ linkError: "1" }) })).rejects.toThrow(/^NEXT_REDIRECT \/settings\?linkError=1$/);
});

test("the query is passed on encoded and only under /settings, never as a way to another page", async () => {
  await expect(AccountPage({ searchParams: Promise.resolve({ next: "//evil.example/x", a: ["1", "2"] }) }))
    .rejects.toThrow(/^NEXT_REDIRECT \/settings\?next=%2F%2Fevil\.example%2Fx&a=1&a=2$/);
});
