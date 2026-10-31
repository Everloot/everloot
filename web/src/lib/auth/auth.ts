import { createHmac } from "node:crypto";
import { betterAuth, type DBAdapterInstance } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth, multiSession } from "better-auth/plugins";
import type { Pool } from "pg";
import { siteUrl } from "@/lib/supabase/server";
import { battlenetProvider, isPlaceholderEmail } from "./battlenet";
import { authPool, pgRateLimitStore, withAuthDatabase, type RateLimitStore } from "./db";
import { emailConfigured, resetText, sendEmail, verificationText } from "./email";
import { configuredSocialProviders } from "./social";

export function authV2Enabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.EVERLOOT_AUTH_V2 === "1";
}

/** Which sign-in buttons the pages show. Email needs the Better Auth flag and a mail sender. */
export function signInMethods(env: Record<string, string | undefined> = process.env) {
  return {
    battlenet: Boolean(env.BNET_CLIENT_ID?.trim() && env.BNET_CLIENT_SECRET?.trim()),
    email: authV2Enabled(env) && emailConfigured(env),
  };
}

const noProviderTokens = { accessToken: null, refreshToken: null, idToken: null };

export function createAuth(options: {
  database: Pool | DBAdapterInstance;
  rateLimitStore: RateLimitStore;
  env?: NodeJS.ProcessEnv;
}) {
  const env = options.env ?? process.env;
  const { rateLimitStore } = options;
  const { BNET_CLIENT_ID, BNET_CLIENT_SECRET } = env;
  const battlenetConfigured = Boolean(BNET_CLIENT_ID?.trim() && BNET_CLIENT_SECRET?.trim());
  // Better Auth would also start on AUTH_SECRET, which would leave the limiter's HMAC with an empty key.
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  // Keyed, so the stored digests cannot be matched by hashing every address.
  const rateLimitKey = (key: string) => createHmac("sha256", secret).update(key).digest("hex");
  return betterAuth({
    database: options.database,
    secret,
    baseURL: env.BETTER_AUTH_URL?.trim() || siteUrl(),
    basePath: "/api/auth",
    trustedOrigins: [siteUrl()],
    socialProviders: Object.fromEntries(configuredSocialProviders(env).map((provider) => {
      const prefix = provider.toUpperCase();
      return [provider, {
        clientId: env[`${prefix}_CLIENT_ID`]!.trim(),
        clientSecret: env[`${prefix}_CLIENT_SECRET`]!.trim(),
        ...(provider === "microsoft" ? {
          tenantId: "common", prompt: "select_account", disableDefaultScope: true,
          scope: ["openid", "profile", "email", "User.Read"],
        } : {}),
        ...(provider === "google" ? { prompt: "select_account" } : {}),
        ...(provider === "discord" ? { prompt: "consent" } : {}),
      }];
    })),
    // Off until Resend is set up: an account nobody can verify is an account nobody can use.
    emailAndPassword: {
      enabled: emailConfigured(env),
      requireEmailVerification: true,
      minPasswordLength: 10,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) =>
        sendEmail(env, { to: user.email, subject: "Reset your Everloot password", text: resetText(url) }),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: ({ user, url }) =>
        sendEmail(env, { to: user.email, subject: "Confirm your Everloot email", text: verificationText(url) }),
    },
    hooks: {
      // Battle.net users hold a placeholder address; taking one would block that player's next sign-in.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;
        const email = (ctx.body as { email?: unknown } | undefined)?.email;
        if (typeof email === "string" && isPlaceholderEmail(email.trim())) {
          throw new APIError("BAD_REQUEST", { message: "Use a real email address." });
        }
      }),
    },
    user: {
      modelName: "users",
      fields: { emailVerified: "email_verified", createdAt: "created_at", updatedAt: "updated_at" },
      // A provider may return an unverified email. Only Battle.net may use its reserved placeholder;
      // otherwise someone could reserve a future Battle.net user's address before their first sign-in.
      validateUserInfo: ({ user, source }) => {
        if (source.oauth?.providerId !== "battlenet" && typeof user.email === "string" && isPlaceholderEmail(user.email)) {
          return { error: "reserved_email" };
        }
      },
    },
    session: {
      modelName: "auth_session",
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      fields: {
        userId: "user_id", expiresAt: "expires_at", ipAddress: "ip_address", userAgent: "user_agent",
        createdAt: "created_at", updatedAt: "updated_at",
      },
    },
    account: {
      modelName: "auth_account",
      fields: {
        userId: "user_id", accountId: "account_id", providerId: "provider_id",
        accessToken: "access_token", refreshToken: "refresh_token", idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at", refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at", updatedAt: "updated_at",
      },
      // Battle.net sign-ins are matched by their auth_account row, which the migration's backfill and
      // trigger give every Battle.net user. Linking by email stays off while the email is unverified.
      accountLinking: {
        enabled: true,
        // Matching emails must be verified on both sides. Battle.net has no email; its reserved
        // placeholder cannot be registered through email signup. Other providers are never forced trusted.
        requireLocalEmailVerified: true,
        trustedProviders: ["battlenet"],
        // Linking from an authenticated session also works for Battle.net's placeholder address.
        allowDifferentEmails: true,
      },
      // The OAuth state lives in a signed cookie: a sign-in start writes no database row.
      storeStateStrategy: "cookie",
    },
    verification: {
      modelName: "auth_verification",
      fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" },
    },
    advanced: {
      cookiePrefix: "everloot",
      useSecureCookies: env.NODE_ENV === "production",
      database: { generateId: "uuid" },
      // On the Cloudflare Worker only cf-connecting-ip is read: Cloudflare's edge sets it, so a caller cannot send
      // one in its place. Off the Worker (local runs) x-forwarded-for is read (Better Auth ignores it when it holds a chain).
      ipAddress: { ipAddressHeaders: env.EVERLOOT_PLATFORM === "cloudflare" ? ["cf-connecting-ip"] : ["x-forwarded-for"] },
    },
    rateLimit: {
      enabled: true,
      // The key is "<address>|<path>"; only its HMAC reaches storage.
      customStorage: { consume: (key, rule) => rateLimitStore.consume(rateLimitKey(key), rule) },
    },
    databaseHooks: {
      account: {
        create: {
          // bnet_id and battletag are filled by the auth_account trigger, in the same transaction.
          before: async (account) => ({ data: { ...account, ...noProviderTokens } }),
        },
        update: {
          before: async (account) => ({ data: { ...account, ...noProviderTokens } }),
        },
      },
      session: {
        create: {
          before: async (session) => ({ data: { ...session, ipAddress: null, userAgent: null } }),
        },
      },
    },
    plugins: [
      genericOAuth({ config: battlenetConfigured ? [battlenetProvider({ BNET_CLIENT_ID, BNET_CLIENT_SECRET })] : [] }),
      // Up to 5 accounts signed in on one browser (the account switcher). Each sign-in also keeps its token in a
      // signed `_multi-` cookie; its endpoints are reached only from /api/me/accounts and /api/auth/logout.
      multiSession({ maximumSessions: 5 }),
      // Must stay last: it copies the cookies of direct getSession calls (the daily refresh) onto the response.
      nextCookies(),
    ],
  });
}

let auth: ReturnType<typeof createAuth> | undefined;

// Built on first use, never at import: the Next build imports route modules.
function getAuth() {
  auth ??= createAuth({ database: authPool(), rateLimitStore: pgRateLimitStore(authPool()) });
  return auth;
}

/** Every Worker operation owns its auth instance and database sockets. Node keeps its process pool. */
export async function withAuth<T>(run: (auth: ReturnType<typeof createAuth>) => Promise<T>): Promise<T> {
  if (process.env.EVERLOOT_PLATFORM !== "cloudflare") return run(getAuth());
  return withAuthDatabase((pool) => run(createAuth({ database: pool, rateLimitStore: pgRateLimitStore(pool) })));
}
