import type { FacetKey } from "@/lib/lore";

const LABELS: Record<FacetKey, string> = {
  expansion: "Expansion", profession: "Profession", class: "Class", race: "Race", zone: "Zone", faction: "Faction",
};

/** Plain GET form: one select per facet that has values for this type; works without JavaScript. */
export default function BrowseFilters({
  action, letter, values, selected,
}: {
  action: string;
  letter: string;
  values: Record<FacetKey, string[]>;
  selected: Partial<Record<FacetKey, string>>;
}) {
  const keys = (Object.keys(LABELS) as FacetKey[]).filter((k) => values[k].length > 0);
  if (keys.length === 0) return null;
  return (
    <form action={action} method="get" className="flex flex-wrap items-end gap-3 text-sm">
      {letter && <input type="hidden" name="letter" value={letter} />}
      {keys.map((key) => (
        <label key={key} className="flex flex-col gap-1 text-fg-2">
          {LABELS[key]}
          <select name={key} defaultValue={selected[key] ?? ""} className="min-h-11 rounded-control border border-edge bg-canvas px-2 text-fg">
            <option value="">Any</option>
            {values[key].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
      ))}
      <button type="submit" className="btn btn-primary min-h-11">Apply</button>
    </form>
  );
}
