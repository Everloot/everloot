import type { ReactNode } from "react";

// Each sign-in provider's mark, copied unchanged from its owner's kit. Sources and terms are in THIRD_PARTY.md; the
// marks are their owners' trademarks and are not covered by Everloot's AGPL licence.
// - Google: the current "G" from Google's pre-approved Sign in with Google button bundle, kept as Google's own file
//   (web/public/brand/google/g-logo.svg, cropped to the logo) because the Sign in with Google guidelines forbid
//   redrawing or recolouring it.
// - Microsoft: the four squares from the Sign in with Microsoft branding guidelines.
// - Twitch: the purple Glitch (with its white fill) from Twitch's brand package.
// - Discord: the Blurple symbol from Discord's brand kit.
// - GitHub: the Invertocat as Primer Octicons draws it (`mark-github`, MIT), in white, one of the two colours
//   GitHub's logo rules allow, on a plain dark tile.
// Battle.net has no mark here: Blizzard publishes no logo licence for third-party sign-in buttons, so its button stays text.

const MICROSOFT = (
  <>
    <rect x="1" y="1" width="9" height="9" fill="#f25022" />
    <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
    <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
    <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
  </>
);

const TWITCH = (
  <>
    <polygon fill="#FFFFFF" points="2200,1300 1800,1700 1400,1700 1050,2050 1050,1700 600,1700 600,200 2200,200" />
    <path fill="#9146FF" d="M500,0L0,500v1800h600v500l500-500h400l900-900V0H500z M2200,1300l-400,400h-400l-350,350v-350H600V200h1600V1300z" />
    <rect fill="#9146FF" x="1700" y="550" width="200" height="600" />
    <rect fill="#9146FF" x="1150" y="550" width="200" height="600" />
  </>
);

const DISCORD = (
  <path fill="#5865f2" d="M81.15,0c-1.2376,2.1973-2.3489,4.4704-3.3591,6.794-9.5975-1.4396-19.3718-1.4396-28.9945,0-.985-2.3236-2.1216-4.5967-3.3591-6.794-9.0166,1.5407-17.8059,4.2431-26.1405,8.0568C2.779,32.5304-1.6914,56.3725.5312,79.8863c9.6732,7.1476,20.5083,12.603,32.0505,16.0884,2.6014-3.4854,4.8998-7.1981,6.8698-11.0623-3.738-1.3891-7.3497-3.1318-10.8098-5.1523.9092-.6567,1.7932-1.3386,2.6519-1.9953,20.281,9.547,43.7696,9.547,64.0758,0,.8587.7072,1.7427,1.3891,2.6519,1.9953-3.4601,2.0457-7.0718,3.7632-10.835,5.1776,1.97,3.8642,4.2683,7.5769,6.8698,11.0623,11.5419-3.4854,22.3769-8.9156,32.0509-16.0631,2.626-27.2771-4.496-50.9172-18.817-71.8548C98.9811,4.2684,90.1918,1.5659,81.1752.0505l-.0252-.0505ZM42.2802,65.4144c-6.2383,0-11.4159-5.6575-11.4159-12.6535s4.9755-12.6788,11.3907-12.6788,11.5169,5.708,11.4159,12.6788c-.101,6.9708-5.026,12.6535-11.3907,12.6535ZM84.3576,65.4144c-6.2637,0-11.3907-5.6575-11.3907-12.6535s4.9755-12.6788,11.3907-12.6788,11.4917,5.708,11.3906,12.6788c-.101,6.9708-5.026,12.6535-11.3906,12.6535Z" />
);

const GITHUB = (
  <path fill="#FFFFFF" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
);

// Every mark keeps its own proportions inside the square box (the default preserveAspectRatio), never stretched.
const MARKS: Record<string, { viewBox: string; mark: ReactNode }> = {
  microsoft: { viewBox: "0 0 21 21", mark: MICROSOFT },
  twitch: { viewBox: "0 0 2400 2800", mark: TWITCH },
  discord: { viewBox: "0 0 126.644 96", mark: DISCORD },
  github: { viewBox: "0 0 16 16", mark: GITHUB },
};

/** Google's own "G" file, served from the site (no Google script or request). */
export const GOOGLE_G = "/brand/google/g-logo.svg";

/** Whether the provider has a mark here (Battle.net and email do not). */
export const hasProviderLogo = (provider: string) => provider === "google" || Object.hasOwn(MARKS, provider);

/** The provider's mark at `size` px, decorative (the button or row names the provider). Null for a provider without one. */
export default function ProviderLogo({ provider, size = 18 }: { provider: string; size?: number }) {
  if (provider === "google") {
    // eslint-disable-next-line @next/next/no-img-element -- a 20 px SVG; next/image would only add a wrapper.
    return <img data-provider-logo="google" src={GOOGLE_G} width={size} height={size} alt="" aria-hidden="true" className="shrink-0" />;
  }
  const logo = MARKS[provider];
  if (!logo) return null;
  return (
    <svg data-provider-logo={provider} viewBox={logo.viewBox} width={size} height={size} aria-hidden="true" focusable="false" className="shrink-0">
      {logo.mark}
    </svg>
  );
}
