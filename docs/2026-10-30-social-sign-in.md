# Social sign-in

Google, Microsoft, Twitch and Discord use Better Auth's built-in providers. Battle.net keeps its
existing sign-in URL and generic OAuth provider. Sign-in, sign-up and adding an account share the
same social controls. Account settings show linked providers and offer the configured methods
that are not linked yet.

## Configuration

`EVERLOOT_AUTH_V2` must equal `1`. Each social provider needs both `<PROVIDER>_CLIENT_ID` and
`<PROVIDER>_CLIENT_SECRET`; blank or incomplete pairs do not register the provider or show a button.
Register `https://everloot.app/api/auth/callback/<provider>` for each provider. Microsoft uses the
`common` tenant for work, school and personal accounts. Discord requests only `identify email`,
without bot or server permissions. Providers that supply no email cannot create an account.

The accounts migration and `BETTER_AUTH_SECRET` are still required. The Worker uses an
`AUTH_DB_HYPERDRIVE` binding connected as `everloot_auth`, with query caching disabled so revoked
sessions cannot be served from a query cache. Each auth operation owns a short-lived pool that
closes after its work finishes. Node/local runs retain `AUTH_DATABASE_URL` and the CA-pinned pool.
Email sign-up retains its separate sender requirement. See
[the account design](design/specs/2026-10-18-accounts-sign-in-design.md) for migration and session rules.

## Linking and storage

Automatic linking requires a matching email verified on both the existing account and the incoming
provider. Linking from an authenticated session may use a different verified email. Battle.net has
no email and is trusted for explicit linking through its reserved placeholder; other providers cannot
create or use an address ending in `@users.everloot.invalid`. An identity already linked to another
Everloot account cannot be claimed.

Provider tokens are discarded on both account creation and update. Sessions retain no IP address or
user agent. The browser reaches only the provider callbacks and the existing email routes, plus
same-origin `POST /api/auth/sign-in/social` and `POST /api/auth/link-social`. Session inspection,
token retrieval and unlink endpoints remain unavailable through the catch-all route. Removing a login
needs a separate implementation with an atomic last-login check.

## Acceptance before activation

This change does not enable the production auth flag or apply database changes. Before activation:

1. Verify the existing-account backfill, role permissions, signing secret and supported database
   connection on the Worker. Keep the current account IDs, keys and builds.
2. Verify the registered callbacks, and test sign-in, cancellation, safe return paths and linked
   logins with each real provider. A matching-email test must cover unverified email rejection.
3. Check a migrated Battle.net account, adding an account on the same browser, logout and the
   account-switching limit. Verify provider tokens remain null in storage.
4. Check the sign-in, sign-up and account pages on desktop and a phone, including keyboard focus,
   pending buttons and error messages. Keep the current legacy sign-in available until acceptance.

The focused regression suite is:

```sh
cd web
npx vitest run src/lib/auth src/app/api/auth src/app/sign-in src/app/sign-up src/app/account src/components/SocialSignIn.test.tsx
npm run typecheck
```

Library references: [provider setup](https://better-auth.com/docs/authentication/discord),
[Microsoft configuration](https://better-auth.com/docs/authentication/microsoft) and
[account linking](https://better-auth.com/docs/concepts/users-accounts).
