import type { Metadata } from "next";
import Link from "next/link";
import { Callout, C, H2, List, P, docLink } from "@/components/docs/blocks";
import DocPage from "@/components/docs/DocPage";
import { KEYS_PER_ACCOUNT } from "@/lib/api-keys";
import { showcaseOn } from "@/lib/character-showcase";
import { guardOn } from "@/lib/data-guard";
import { profilesOn } from "@/lib/profiles";
import { savedBuildsOn } from "@/lib/saved-builds";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Your Everloot account",
  description: "What an Everloot account is for today, how to sign in with Battle.net or email, what Settings shows, and how to make, roll and revoke API keys.",
  path: "/docs/guides/account",
});

export default function Page() {
  // Read at build time, like the keys page: switching saved builds on takes a redeploy, which rebuilds this page.
  const builds = savedBuildsOn();
  const profiles = profilesOn();
  const keys = guardOn();
  const showcase = showcaseOn();
  return (
    <DocPage href="/docs/guides/account">
      <P>
        {builds
          ? <>An account is for two things today: saving talent builds and making API keys.</>
          : <>An account is for one thing today: making API keys.</>}{" "}
        You do not need one to read the site, search, use the tools or upload your addon data. The API works without one too, within the limits described below.
      </P>

      <H2 id="signing-in">Signing in</H2>
      <P>
        Go to <Link href="/sign-in" className={docLink}>the sign-in page</Link>. It shows the ways to sign in that are
        available right now. There are two kinds:
      </P>
      <List>
        <li><strong>Battle.net.</strong> Your first sign-in makes the account.</li>
        <li><strong>Email.</strong> You make an account with your email address, a name and a password, and confirm the address from the link we send. This is offered only when it is switched on. If it is, <Link href="/sign-up" className={docLink}>the sign-up page</Link> has the form. If it is not, that page says email sign-up is not open yet.</li>
      </List>
      <P>
        If you are already signed in, the sign-in page sends you to Settings. Sign-in is not required for anything else.
      </P>
      <Callout kind="note">
        <p>
          Signing in does not publish your named addon records, and it does not make you a guild officer. Named sharing
          is a separate choice on the <Link href="/docs/guides/upload" className={docLink}>upload page</Link>.
        </p>
      </Callout>

      <H2 id="your-account">Settings</H2>
      <P>
        <Link href="/settings" className={docLink}>Settings</Link> holds everything about your account, in six sections with
        links to each at the top. Only you can open it. Old links to <C>/account</C> land there.
      </P>
      <List>
        <li>
          <strong>Profile.</strong> Your BattleTag or account name, how you sign in and when you joined, the email on the
          account if it has one, and a link to change your password if you signed up with one.
          {profiles && <> Your handle, display name, public profile switch, status and main character are edited here.</>}
          {(profiles || builds) && <> How many characters{builds && <> and <Link href="/me" className={docLink}>saved builds</Link></>} you have.</>}
          {keys && <> How many API keys you have, and how many requests they made in the last 7 days.</>}
        </li>
        <li>
          <strong>Characters &amp; sync.</strong> {profiles && <>Your characters and which is your main. </>}What the Desktop App
          syncs, and the plans and alts kept on this device, which stay in this browser and never reach your account.
        </li>
        <li><strong>Privacy.</strong> What we keep and where you change who sees what.</li>
        <li>
          <strong>Integrations.</strong> Your sign-in methods, the Desktop App, Claude and ChatGPT, each with a status and a
          <strong> How to connect</strong> drawer.
          {keys && <> Each live key shows when it was last used, and <strong>Disconnect</strong> revokes it.</>}{" "}
          Claude and ChatGPT reach Everloot without a key, so your account keeps no record of them and they show as
          <strong> Not tracked</strong>; you disconnect them in Claude or ChatGPT.
        </li>
        <li>
          <strong>API keys.</strong> Your keys, described below, and <strong>Assistant setup</strong>: optional AI, one card per
          provider Chat supports, with its key, its model and a Test button. Those keys stay in that tab until it closes and never reach Everloot.
        </li>
        <li><strong>Danger zone.</strong> Where to revoke keys, delete saved builds or unlink characters, and how to delete your account.</li>
      </List>
      {showcase && (
        <P>
          What your character page looks like once you link a character: see the{" "}
          <Link href="/showcase/character" className={docLink}>sample character</Link>, which is made-up data.
        </P>
      )}

      <H2 id="api-keys">API keys</H2>
      <P>
        An API key is a free token you send with requests to the Everloot API and the MCP server. Every endpoint works
        without one, within the limits on the <Link href="/docs/api/keys" className={docLink}>limits and keys page</Link>,
        which also says how to send a key.
      </P>
      <List>
        <li>
          Choose <strong>Create API key</strong> in Settings. Give it a name, say in a sentence what it is for, pick
          its permissions and pick when it expires: 7, 30 or 90 days, a year, or a date of your own. 90 days is a good default.
        </li>
        <li>A key starts with <C>evl_</C>. It is shown once, when you make it, so copy it then. We store only a one-way hash of it.</li>
        <li>You can have {KEYS_PER_ACCOUNT} active keys at a time. Revoke one to make another; expired keys do not count.</li>
        <li>
          The list shows each key&apos;s name, what it is for, its last four characters, its permissions, when it was made,
          when it expires and when it was last used.
        </li>
        <li>Revoking a key stops it at once. So does reaching its end date.</li>
        <li><strong>Roll</strong> gives a key a new secret with the same name, permissions and lifetime, and stops the old one.</li>
        {builds && <li>A key made with <strong>Read my saved builds</strong> can also read your saved builds. The Desktop App uses one to put your builds in the game.</li>}
      </List>
      <Callout kind="warning">
        <p>
          Treat a key like a password. Do not put it in a web page, a public repository or a script you share.
        </p>
      </Callout>
      <P>
        If keys are not switched on, Settings says so, and every endpoint keeps working without one.
      </P>

      <H2 id="your-data">Your data</H2>
      <P>
        What we store about an account, and how to have it deleted, is in the{" "}
        <Link href="/privacy" className={docLink}>Privacy Policy</Link>. The short version is in{" "}
        <Link href="/docs/guides/privacy" className={docLink}>privacy and your data</Link>.
      </P>
    </DocPage>
  );
}
