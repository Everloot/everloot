import { CLIENT_ACHIEVEMENTS } from "@/data/game-data/client-achievements";
import { listHref } from "../list-parts";

// The achievement categories as the game files nest them (`Achievement_Category`, found in game files, unconfirmed),
// for the list's grouping and an achievement page's category path. A category is named in the list's URL by its name,
// as the list's Category filter already names it.

export interface CategoryStep { id: number; name: string }

/** The category and the ones above it, top first; empty for an id the files do not name. */
export function categoryPath(id: number | undefined): CategoryStep[] {
  const out: CategoryStep[] = [];
  const seen = new Set<number>();
  for (let at = id; at !== undefined && !seen.has(at); ) {
    seen.add(at);
    const c = CLIENT_ACHIEVEMENTS.categories?.[String(at)];
    if (!c) break;
    out.unshift({ id: at, name: c.name });
    at = c.parent;
  }
  return out;
}

/** The files' category path of an achievement, when the files carry it; none while the file cannot be read. */
export function pathOfAchievement(achievementId: number): CategoryStep[] {
  try {
    return categoryPath(CLIENT_ACHIEVEMENTS.achievements[String(achievementId)]?.category);
  } catch {
    return [];
  }
}

/** The list filtered to one category (and, through `inCategory`, everything under it). */
export const categoryHref = (name: string) => listHref("/database/achievements", [["category", name]]);

/**
 * Whether a listed achievement belongs under `filter`: its own category is that name, or the files file it under a
 * category whose path holds it (Adventure holds Eastern Kingdoms). A category players reported wins over the files'
 * path, so the path counts only while it ends at the listed category.
 */
export function inCategory(row: { achievementId: number; category: string }, filter: string): boolean {
  if (row.category === filter) return true;
  const path = pathOfAchievement(row.achievementId);
  return path.at(-1)?.name === row.category && path.some((s) => s.name === filter);
}

export interface CategoryTotal { name: string; achievements: number; points: number }
export interface CategoryGroup extends CategoryTotal { children: CategoryTotal[] }

/**
 * The listed achievements grouped by their top category, each with the categories under it, with how many
 * achievements and points each holds. A category players reported that the files do not lead to is its own group.
 * Groups in the files' order (by id), a reported-only group after them by name.
 */
export function categoryGroups(rows: readonly { achievementId: number; category: string; points: number }[]): CategoryGroup[] {
  const groups = new Map<string, CategoryGroup & { order: number }>();
  for (const row of rows) {
    if (!row.category) continue;
    const path = pathOfAchievement(row.achievementId);
    const filed = path.at(-1)?.name === row.category;
    const top = filed ? path[0]! : { id: Number.MAX_SAFE_INTEGER, name: row.category };
    const group = groups.get(top.name) ?? { name: top.name, achievements: 0, points: 0, children: [], order: top.id };
    groups.set(top.name, group);
    group.achievements += 1;
    group.points += row.points;
    if (filed && path.length > 1) {
      const leaf = path.at(-1)!.name;
      const child = group.children.find((c) => c.name === leaf) ?? { name: leaf, achievements: 0, points: 0 };
      if (!group.children.includes(child)) group.children.push(child);
      child.achievements += 1;
      child.points += row.points;
    }
  }
  return [...groups.values()]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map(({ order: _order, ...g }) => ({ ...g, children: [...g.children].sort((a, b) => a.name.localeCompare(b.name)) }));
}
