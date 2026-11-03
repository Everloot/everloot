/** Public provider names only. Credentials stay in the server's auth configuration. */
// The order is the order of the tiles on /sign-in: the ones WoW players reach for first.
export const SOCIAL_PROVIDERS = ["google", "github", "discord", "twitch", "microsoft"] as const;
export type SocialProvider = typeof SOCIAL_PROVIDERS[number];
export const PROVIDER_NAMES: Record<string, string> = {
  battlenet: "Battle.net", google: "Google", github: "GitHub", discord: "Discord", twitch: "Twitch", microsoft: "Microsoft",
  credential: "Email and password",
};

export function configuredSocialProviders(env: Record<string, string | undefined> = process.env): SocialProvider[] {
  if (env.EVERLOOT_AUTH_V2 !== "1") return [];
  return SOCIAL_PROVIDERS.filter((provider) => {
    const prefix = provider.toUpperCase();
    return Boolean(env[`${prefix}_CLIENT_ID`]?.trim() && env[`${prefix}_CLIENT_SECRET`]?.trim());
  });
}
