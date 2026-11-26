// Which item begins which quest, from the game files (ItemSparse.StartQuestID). The JSON beside this file is generated
// by `npm run kb -- client-quest-starts` (see README.md); do not edit it by hand.
import questStartsJson from "./client-quest-starts.json";
import { ClientQuestStarts } from "@kb/client-quest-starts";

export const CLIENT_QUEST_STARTS: ClientQuestStarts = ClientQuestStarts.parse(questStartsJson);

const questOf = new Map(CLIENT_QUEST_STARTS.starts);
const itemsOf = new Map<number, number[]>();
for (const [item, quest] of CLIENT_QUEST_STARTS.starts) itemsOf.set(quest, [...(itemsOf.get(quest) ?? []), item]);

/** The quest the item begins, as the files say; undefined when it begins none. */
export const questStartedBy = (itemId: number): number | undefined => questOf.get(itemId);

/** The items that begin the quest, by item id; empty when the files name none. */
export const itemsStartingQuest = (questId: number): readonly number[] => itemsOf.get(questId) ?? [];
