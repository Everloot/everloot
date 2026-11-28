"""Reduce a local Forever client snapshot and pinned EG Link JSON to guide facts.

Run from the repository root with the 71139 snapshot and a folder of pinned
EG Link exports. Download trainers.json, vendors.json and game_rules.json
for EG_BUILDS and quests.enUS.json for EG_QUEST_BUILDS from EG_URL, keeping
the build number as a filename prefix (for example 71139-trainers.json).
The generated file credits Efficient Games and contains no copied game text.
"""

import argparse
import json
import sqlite3
from collections import defaultdict
from pathlib import Path


EG_COMMIT = "1339ce5600bbc2b12e8f1081e584f548f62fa57f"
EG_BUILDS = (71139, 71091, 71037, 70959, 70938, 70888, 70862, 70840, 70790)
EG_URL = f"https://github.com/JIVESCORP/eg-link-output-wowf/tree/{EG_COMMIT}/data/wowf"
EG_QUEST_BUILDS = (71139, 71091, 71037)
DATA = Path("web/src/data/game-data")


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def table(db, kind, ids):
    return [
        entry
        for (raw,) in db.execute("SELECT raw FROM client_rows WHERE tbl = ? ORDER BY id", (kind,))
        if (entry := json.loads(raw)).get("SpellID", entry.get("Spell", entry.get("ID"))) in ids
    ]


def client_facts(db, recipes):
    by_spell = {}
    for entry in table(db, "SkillLineAbility", recipes):
        spell_id = entry["Spell"]
        facts = by_spell.setdefault(spell_id, {})
        if "points" in facts:
            continue
        facts["points"] = entry["NumSkillUps"]
        if entry["AcquireMethod"] in (1, 2) and entry["MinSkillLineRank"] == 1:
            facts["starter"] = True
    for entry in table(db, "SpellCooldowns", recipes):
        if entry["RecoveryTime"] > 0 or entry["CategoryRecoveryTime"] > 0:
            by_spell[entry["SpellID"]]["cooldown"] = True
    for entry in table(db, "SpellCastingRequirements", recipes):
        if entry["RequiresSpellFocus"] > 0:
            by_spell[entry["SpellID"]]["focus"] = entry["RequiresSpellFocus"]
    for entry in table(db, "SpellTotems", recipes):
        facts = by_spell[entry["SpellID"]]
        tools = [item for item in entry["Totem"] if item > 0]
        categories = [category for category in entry["RequiredTotemCategoryID"] if category > 0]
        if tools:
            facts["tools"] = tools
        if categories:
            facts["toolCategories"] = categories
    outputs = defaultdict(list)
    for entry in table(db, "SpellEffect", recipes):
        spell = entry["SpellID"]
        if entry["DifficultyID"] == 0 and entry["Effect"] == 24 and entry["EffectItemType"] == recipes[spell][1]:
            outputs[spell].append(entry)
    for spell, effects in outputs.items():
        if len(effects) != 1:
            continue
        effect = effects[0]
        quantity = effect["EffectBasePointsF"]
        if quantity > 0 and quantity == int(quantity) and not any(
            effect.get(field, 0) for field in ("Variance", "EffectDieSides", "EffectRealPointsPerLevel",
                                              "EffectPointsPerResource", "ScalingClass")
        ):
            by_spell[spell]["quantity"] = int(quantity)
    return by_spell


def source_rows(folder, build, kind, payload=None):
    data = load_json(folder / f"{build}-{kind}.json")
    meta = data["meta"]
    dataset, dot, locale = kind.partition(".")
    expected = {"dataset": dataset, "clientBuild": f"1.60.1.{build}", "product": "wowf", "license": "CC BY 4.0"}
    if dot:
        expected["locale"] = locale
    if any(meta.get(key) != value for key, value in expected.items()):
        raise ValueError(f"Invalid EG Link metadata for {build} {kind}")
    return data[payload or dataset], meta["collectedOn"]["last"]


def trainer_facts(folder, professions):
    result = {}
    for build in EG_BUILDS:
        trainers, as_of = source_rows(folder, build, "trainers")
        candidates = defaultdict(list)
        for npc_id, trainer in trainers.items():
            for spell, service in trainer["services"].items():
                spell = int(spell)
                if (spell in result or spell != service.get("spellId") or spell not in professions
                        or service.get("skill") != professions[spell]
                        or service.get("step") or service.get("profession") or service.get("bartered")):
                    continue
                rank = service.get("skillRank")
                if isinstance(rank, int) and 1 <= rank <= 300:
                    candidates[spell].append((int(npc_id), service))
        for spell, rows in candidates.items():
            ranks = {row["skillRank"] for _, row in rows}
            # A conflicting latest observation suppresses this rank instead of falling back to an older one.
            if len(ranks) != 1:
                result[spell] = None
                continue
            neutral_prices = [c for _, row in rows if isinstance(c := row.get("costs", {}).get("4"), int) and c >= 0]
            result[spell] = [ranks.pop(), build, as_of, min(neutral_prices, default=None),
                             sorted({npc for npc, _ in rows})]
    return {spell: row for spell, row in result.items() if row is not None}


def vendor_facts(folder, relevant_item_ids):
    result = {}
    for build in EG_BUILDS:
        vendors, as_of = source_rows(folder, build, "vendors")
        candidates = defaultdict(list)
        for npc_id, vendor in vendors.items():
            for offer in vendor.get("entries", {}).values():
                item = offer.get("itemId")
                if item in relevant_item_ids and item not in result:
                    candidates[item].append((int(npc_id), offer))
        for item, offers in candidates.items():
            prices = [
                price // stack for _, offer in offers
                if not offer.get("limited") and not offer.get("costItems") and not offer.get("bartered")
                and isinstance(stack := offer.get("stack"), int) and stack > 0
                and isinstance(price := offer.get("costs", {}).get("4"), int) and price > 0 and price % stack == 0
            ]
            result[item] = [min(prices, default=None), build, as_of, sorted({npc for npc, _ in offers})]
    return result


def quest_facts(folder):
    # The initial import covers the specific end-of-range recipe gaps. Negative evidence is not inferred.
    targets = {
        6032: ("spell", 19435), 7654: ("item", 12700), 7658: ("item", 12715),
        6610: ("spell", 18260), 6607: ("spell", 18248), 6622: ("spell", 10846), 6624: ("spell", 10846),
    }
    result = {}
    for build in EG_QUEST_BUILDS:
        quests, as_of = source_rows(folder, build, "quests.enUS")
        for quest_id, (kind, expected_id) in targets.items():
            quest = quests.get(str(quest_id))
            if quest_id in result or not quest:
                continue
            rewards = quest.get("rewards", {})
            received = (rewards.get("displaySpells", []) if kind == "spell" else rewards.get("items", []))
            if not any(r.get(kind + "Id") == expected_id for r in received):
                continue
            items = [[o["objectId"], o["amount"]] for o in quest.get("objectives", []) if o.get("type") == "item"]
            result[quest_id] = [kind, expected_id, build, as_of, quest["minLevel"], items]
    if set(result) != set(targets):
        raise ValueError("The pinned EG Link source no longer contains all verified quest rewards")
    return result


def profession_ranks(db, folder, professions, quests):
    spells = {}
    for (raw,) in db.execute(
        "SELECT raw FROM client_rows WHERE tbl = 'SpellEffect' AND json_extract(raw, '$.Effect') = 118"
    ):
        row = json.loads(raw)
        skill_id, ordinal = row["EffectMiscValue"][0], row["EffectBasePointsF"]
        if skill_id not in professions or ordinal not in (1, 2, 3, 4):
            continue
        # Rank 1 can have additional spells from starting quests. The ordinary profession
        # learning spell has the original, lower ID.
        key = skill_id, int(ordinal)
        spells[key] = min(row["SpellID"], spells.get(key, row["SpellID"]))
    profession_by_spell = {spell: professions[key[0]] for key, spell in spells.items()}
    caps = {}
    trainer_routes = {}
    for build in EG_BUILDS:
        rules, as_of = source_rows(folder, build, "game_rules", payload="professionCaps")
        for skill, ranks in rules.items():
            for ordinal, seen in ranks.items():
                if int(skill) in professions and len(seen) == 1:
                    caps.setdefault((int(skill), int(ordinal)), int(next(iter(seen))))
        trainers, as_of = source_rows(folder, build, "trainers")
        entries = defaultdict(list)
        for npc, trainer in trainers.items():
            for spell, service in trainer["services"].items():
                spell = int(spell)
                if (spell in profession_by_spell and service.get("skill") == profession_by_spell[spell]
                        and service.get("step") and not service.get("bartered") and service.get("skillRank", 0) > 0):
                    entries[spell].append((int(npc), service))
        for spell, rows in entries.items():
            skills = {s["skillRank"] for _, s in rows}
            if len(skills) != 1 or spell in trainer_routes:
                continue
            levels = {s["level"] for _, s in rows if s.get("level", 0) > 0}
            source = {
                "kind": "trainer", "npcIds": sorted({npc for npc, _ in rows}), "minimumSkill": skills.pop(),
                "build": f"1.60.1.{build}", "asOf": as_of,
            }
            if len(levels) == 1:
                source["minimumLevel"] = levels.pop()
            trainer_routes[spell] = source
    rank_books = {3413: 16072, 7732: 16083, 7924: 16084}
    book_stats = {row["ID"]: row for row in table(db, "ItemSparse", set(rank_books.values()))}
    for spell, item in rank_books.items():
        if item in book_stats:
            row = book_stats[item]
            route = {"kind": "book", "itemId": item, "minimumSkill": row["RequiredSkillRank"]}
            if row["RequiredLevel"]:
                route["minimumLevel"] = row["RequiredLevel"]
            trainer_routes[spell] = route
    for spell, quest_ids in {18260: [6610], 18248: [6607], 10846: [6622, 6624]}.items():
        examples = [quests[q] for q in quest_ids]
        if any(q[0] != "spell" or q[1] != spell for q in examples):
            continue
        _, _, build, as_of, level, materials = examples[0]
        trainer_routes[spell] = {
            "kind": "quest", "questIds": quest_ids, "minimumLevel": level, "build": f"1.60.1.{build}", "asOf": as_of,
            "requirements": [{"itemId": item, "count": count} for item, count in materials],
        }
    result = {}
    for skill in sorted(professions):
        stops = []
        for ordinal, name in enumerate(("Journeyman", "Expert", "Artisan"), 1):
            current = skill, ordinal
            after = skill, ordinal + 1
            if current not in spells or after not in spells or current not in caps:
                continue
            stop = {"cap": caps[current], "spellId": spells[current], "nextSpellId": spells[after], "nextRank": name}
            if after in caps and caps[after] > caps[current]:
                stop["nextCap"] = caps[after]
            if spells[after] in trainer_routes:
                stop["source"] = trainer_routes[spells[after]]
            stops.append(stop)
        if stops:
            result[skill] = stops
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("eg_folder", type=Path)
    parser.add_argument("--out", type=Path, default=DATA / "client-profession-guide.json")
    args = parser.parse_args()
    catalog = load_json(DATA / "client-recipes.json")
    teaching = load_json(DATA / "client-recipe-items.json")
    version = catalog["build"]["version"]
    if teaching["build"]["version"] != version:
        raise ValueError("Recipe catalog and teaching item files are for different builds")
    recipes = {row[0]: row for profession in catalog["professions"] for row in profession["recipes"]}
    professions = {row[0]: profession["name"] for profession in catalog["professions"] for row in profession["recipes"]}
    item_ids = {item for r in recipes.values() for item, _ in r[5]}
    teaching_items = {item for linked in teaching["links"].values() for item in linked}
    quests = quest_facts(args.eg_folder)
    with sqlite3.connect(args.snapshot.resolve().as_uri() + "?mode=ro", uri=True) as db:
        build = dict(db.execute("SELECT key, value FROM meta"))["version"]
        if build != version:
            raise ValueError(f"Expected client snapshot {version}, got {build}")
        client = client_facts(db, recipes)
        skill_parents = {
            row["ID"]: row["ParentSkillLineID"]
            for (raw,) in db.execute("SELECT raw FROM client_rows WHERE tbl = 'SkillLine'")
            if (row := json.loads(raw))["ParentSkillLineID"] > 0
        }
        item_requirements = {
            row["ID"]: [skill_parents.get(row["RequiredSkill"], row["RequiredSkill"]), row["RequiredSkillRank"]]
            for row in table(db, "ItemSparse", teaching_items)
            if row["RequiredSkill"] > 0 and row["RequiredSkillRank"] > 0
        }
        rank_stops = profession_ranks(db, args.eg_folder, {p["id"]: p["name"] for p in catalog["professions"]}, quests)
    output = {
        "version": version,
        "credit": "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
        "license": "https://creativecommons.org/licenses/by/4.0/",
        "source": EG_URL,
        "transformation": "Selected numeric trainer, vendor, quest and rank observations, joined to the client and reduced to the latest applicable build.",
        "client": client,
        "teachingRequirements": item_requirements,
        "trainers": trainer_facts(args.eg_folder, professions),
        "vendors": vendor_facts(args.eg_folder, item_ids | teaching_items),
        "quests": quests,
        "rankStops": rank_stops,
    }
    # One recipe or item per line makes build updates reviewable.
    lines = []
    for key, value in output.items():
        if isinstance(value, dict):
            rows = (f"  {json.dumps(str(k))}:{json.dumps(v, separators=(',', ':'))}" for k, v in sorted(value.items()))
            lines.append(f" {json.dumps(key)}:{{\n" + ",\n".join(rows) + "\n }")
        else:
            lines.append(f" {json.dumps(key)}:{json.dumps(value)}")
    args.out.write_text("{\n" + ",\n".join(lines) + "\n}\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
