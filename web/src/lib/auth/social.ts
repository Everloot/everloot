/** Public provider names only. Credentials stay in the server's auth configuration. */
export const SOCIAL_PROVIDERS = ["google", "microsoft", "twitch", "discord"] as const;
export type SocialProvider = typeof SOCIAL_PROVIDERS[number];
export const PROVIDER_NAMES: Record<string, string> = {
  battlenet: "Battle.net", google: "Google", microsoft: "Microsoft", twitch: "Twitch", discord: "Discord",
  credential: "Email and password",
};

export function configuredSocialProviders(env: Record<string, string | undefined> = process.env): SocialProvider[] {
  if (env.EVERLOOT_AUTH_V2 !== "1") return [];
  return SOCIAL_PROVIDERS.filter((provider) => {
    const prefix = provider.toUpperCase();
    return Boolean(env[`${prefix}_CLIENT_ID`]?.trim() && env[`${prefix}_CLIENT_SECRET`]?.trim());
  });
}
