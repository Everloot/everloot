/**
 * The Better Auth switch, apart from ./auth.ts so the layout and the Supabase helpers can read it without loading
 * Better Auth on every page.
 */
export function authV2Enabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.EVERLOOT_AUTH_V2 === "1";
}
