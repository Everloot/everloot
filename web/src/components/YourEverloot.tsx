import { LinkTabs, PageHeader, type PageHeaderProps } from "@/components/ui";
import { profilesOn } from "@/lib/profiles";
import { savedBuildsOn } from "@/lib/saved-builds";

/** The pages of "Your Everloot", in tab order. A page behind a switch that is off is left out. */
export function yourEverlootPages(): { href: string; label: string }[] {
  return [
    { href: "/account", label: "Account" },
    ...(profilesOn() ? [{ href: "/settings", label: "Settings" }] : []),
    ...(savedBuildsOn() ? [{ href: "/me", label: "My builds" }] : []),
    { href: "/tools/builds", label: "Plans on this device" },
    { href: "/tools/alts", label: "Alts on this device" },
    { href: "/upload", label: "Uploads" },
  ];
}

/**
 * The header of every "Your Everloot" page: the site's PageHeader, then one row of tabs between the account,
 * settings, saved builds, the plans and alts kept in this browser, and uploads, so they read as one area.
 * `current` is the page's own path.
 */
export default function YourEverlootHeader({ current, ...header }: PageHeaderProps & { current: string }) {
  return (
    <div data-your-everloot className="mb-6">
      <PageHeader {...header} />
      <LinkTabs label="Your Everloot" tabs={yourEverlootPages().map((p) => ({ ...p, current: p.href === current }))} />
    </div>
  );
}
