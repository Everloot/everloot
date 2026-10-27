import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import PrivacyPage from "./page";

const html = renderToStaticMarkup(<PrivacyPage />).replace(/&#x27;|&apos;/g, "'");
const text = html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
const policy = readFileSync(new URL("../../../../docs/DATA_POLICY.md", import.meta.url), "utf8").replace(/\s+/g, " ");

test("says what Battle.net sign-in stores", () => {
  expect(html).toContain("Battle.net Account ID");
  expect(html).toContain("BattleTag");
});

test("says provider tokens are not kept", () => {
  expect(html).toContain("We don't keep your Battle.net access token");
});

test("says sessions carry no IP address", () => {
  expect(html).toContain("stored with no IP address and no browser details");
});

test("says a session ends at most 30 days after the last visit", () => {
  expect(html).toContain("It ends at most 30 days after your last visit.");
  expect(html).not.toContain("up to 30 days");
});

test("no emoji or pictographs", () => {
  expect(html).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{25A0}-\u{25FF}]/u);
});

test("the cookie line mentions the short-lived sign-in state cookie", () => {
  expect(text).toContain("short-lived one, 10 minutes, that holds the sign-in state while you are at Battle.net");
});

test("the census paragraph says how it starts and leaves, what is kept, what is never read and when counts show", () => {
  for (const claim of [
    "on in a new install of the addon",
    "/everloot census on",
    "/everloot census off",
    "only if you allowed it in the Everloot Desktop App",
    "race, class, level and faction for your own characters, with the realm name",
    "players you target, mouse over or group with",
    "never reads another player's name, guild, gear or position",
    "keyed one-way hash",
    "number of the server",
    "never published one by one",
    "at least 10 characters reported by at least 3 installs",
  ]) expect(text).toContain(claim);
});

test("saved builds: what is kept, that characters are typed labels, that a shared link is public, and deletion", () => {
  for (const claim of [
    "its share codes, the game build, the name and notes you type, and the character you file it under",
    "A character is only a label you type",
    "We don't check it against the game, and nobody else sees it",
    "Anyone you give it to can see the build's name, notes and talents",
    "Turning the link off or deleting the build stops it at once",
    "Deleting your account deletes them all",
    "Saved builds and characters: until you delete them or your account.",
  ]) expect(text).toContain(claim);
  for (const claim of [
    "Character labels are typed, not checked.",
    "A shared link is public to anyone who has it.",
    "deletes every saved build and label with it",
  ]) expect(policy).toContain(claim);
});

test("profiles: private by default, what a public profile shows and never shows, and deletion", () => {
  for (const claim of [
    "a handle, a display name, a status",
    "Your profile is private: only you see it.",
    "only the parts you tick: your characters (name, class and realm), your shared builds and your status",
    "It never shows your BattleTag, your email or a build you did not share",
    "search engines index it only while it is public",
    "Deleting your account deletes your profile with it.",
    "unless you show your characters on a public profile",
    "Handle, display name, status and profile choices: until you change them or delete your account.",
  ]) expect(text).toContain(claim);
  for (const claim of [
    "## Profiles",
    "Private by default.",
    "It never shows the BattleTag, the email, a label's note or a build that is not shared.",
    "A handle changes at most 5 times a day.",
  ]) expect(policy).toContain(claim);
});

test("chat's free model: what goes to the provider, what never does, and what we keep", () => {
  for (const claim of [
    "Chat's free model (optional):",
    "go through our server to Groq, or to Cloudflare Workers AI when Groq is busy or at its limit",
    "Each answer names the provider that wrote it.",
    "A character or note goes only if you attach it.",
    "Nothing else of yours goes: no account details, no key, no cookie and not your address.",
    "We don't keep the questions or the answers.",
    "Groq's terms say it does not train models on them",
    "Cloudflare says it does not use Workers AI content to train models",
    "Rate-limit hashes: a short time, long enough to enforce the limit (a day for Chat's free model), then discarded.",
  ]) expect(text).toContain(claim);
  for (const claim of [
    "## Chat",
    "Everloot (free)",
    "Groq first, then Cloudflare Workers AI",
    "No account data, no key, no cookie and no address goes to the provider.",
    "Cloudflare's say it does not use Workers AI content to train models",
  ]) expect(policy).toContain(claim);
});

test("the retention list says how long census rows are kept", () => {
  expect(text).toContain("Census rows: as long as the upload they came in, and removed with it.");
});

test("the player pages paragraph links the hide form", () => {
  expect(text).toContain("on the hide form");
  expect(html).toContain('href="/players/opt-out"');
});

test("the data policy says the same about the census", () => {
  for (const claim of [
    "on in a new install",
    "off until `/everloot census on`",
    "never their name, guild, gear or position",
    "HMAC-SHA256",
    "keeps the server id",
    "census rows are dropped and nothing from them is stored",
    "never published row by row",
    "at least 10 characters reported by at least 3 installs",
  ]) expect(policy).toContain(claim);
});
