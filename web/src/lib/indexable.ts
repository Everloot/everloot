import { isDevelopmentItemName } from "../../../kb/src/dev-item-names";
import { itemHasFacts, npcHasFacts, objectHasFacts, questHasFacts, vendorHasFacts } from "../../../kb/src/page-urls";
import type { ItemPage } from "../../../kb/src/item-page";
import type { ObjectPage } from "../../../kb/src/object-page";
import type { NpcPage, QuestPage, VendorPage } from "../../../kb/src/world-pages";
import type { ShownItemName } from "./items";

/**
 * Whether a database detail page is indexed. Each page's robots metadata and the database sitemap call the
 * same function, so the sitemap lists exactly the pages that ask to be indexed. With upload storage out of
 * reach a page has no player facts to show, so only an item named under the item name rule stays indexed.
 */

/**
 * Players reported the item (an agreed name, a public drop or a pin), or a source names it in the current build.
 * Never a development leftover: its page stays reachable by id, but search has no use for it.
 */
export const itemIndexable = (page: ItemPage, unreachable: boolean, name: ShownItemName | null): boolean =>
  !isDevelopmentItemName(name?.name) && ((!unreachable && itemHasFacts(page)) || name?.source === "wiki" || name?.source === "files");

export const npcIndexable = (page: NpcPage, unreachable: boolean): boolean => !unreachable && npcHasFacts(page);

export const questIndexable = (page: QuestPage, unreachable: boolean): boolean => !unreachable && questHasFacts(page);

export const objectIndexable = (page: ObjectPage, unreachable: boolean): boolean => !unreachable && objectHasFacts(page);

export const vendorIndexable = (page: VendorPage, unreachable: boolean): boolean => !unreachable && vendorHasFacts(page);

/**
 * A spell named in the game files whose page shows more than its name: tooltip text or a relation. Spell pages
 * are not in the database sitemap; a name alone is a thin page.
 */
export const spellIndexable = (spell: { named: boolean; text: boolean; relations: number }): boolean =>
  spell.named && (spell.text || spell.relations > 0);
