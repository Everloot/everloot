import Link from "@/components/Link";
import { classLabel, type ClassSlug } from "@/lib/class-context";

type ClassPage = "overview" | "abilities" | "talents";

/** Cards link to the overview in their headings. The other class pages include it in the navigation. */
export function ClassLinks({ slug, current }: { slug: ClassSlug; current?: ClassPage }) {
  const name = classLabel(slug);
  const links = [
    ...(current ? [{ key: "overview", label: "Overview", href: `/classes/${slug}`, title: `Overview for ${name}` }] : []),
    { key: "abilities", label: "Abilities", href: `/classes/${slug}/spells`, title: `Abilities for ${name}` },
    { key: "talents", label: "Talents", href: `/tools/talents/${slug}`, title: `Talents for ${name}` },
    { key: "notes", label: "Patch notes", href: `/changes?${new URLSearchParams({ q: name })}`, title: `Patch notes mentioning ${name}` },
  ];
  const item = "inline-flex min-h-11 items-center rounded-control px-2.5 text-sm";
  return (
    <ul className="flex flex-wrap items-center gap-x-1" role="list">
      {links.map(({ key, label, href, title }) => (
        <li key={key}>
          {key === current ? (
            <span className={`${item} bg-panel font-semibold text-fg`} aria-current="page">{label}</span>
          ) : (
            <Link href={href} prefetch={false} aria-label={title} className={`${item} text-fg-2 underline decoration-edge underline-offset-4 hover:text-fg hover:decoration-fg`}>
              {label}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function ClassNavigation({ slug, current }: { slug: ClassSlug; current: ClassPage }) {
  return (
    <nav aria-label={`${classLabel(slug)} pages`} className="mb-4 border-b border-line pb-2">
      <ClassLinks slug={slug} current={current} />
    </nav>
  );
}
