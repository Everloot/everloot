"""Build addon/modules/recipe_cooldown_data.lua from one owned client snapshot (kb/src/client-snapshot.ts output).

Usage: python scripts/build-recipe-cooldowns.py <snapshot.sqlite> [--check]

The snapshot's manifest (<snapshot>.manifest.json) gives the build and the per-table count of encrypted blocks the
extractor could not read; the file's sha256 must match the manifest. Nothing is downloaded or extracted here.

What the addon gets, for that build only:
- covered: every recipe spell the client files list for a trade skill. A SkillLineAbility row on a skill line of
  category 9 (secondary skills) or 11 (professions) whose spell has a SpellEffect CREATE_ITEM (Effect 24) with an
  item, and a SpellMisc row. A recipe outside this set is not classified at all.
- limited: covered spells with a positive RecoveryTime or CategoryRecoveryTime in SpellCooldowns (DifficultyID 0),
  with the cooldown in milliseconds and the SpellCategories Category (shared cooldown) when there is one.
A covered spell without a limited entry has no cooldown recorded in these files. That is not proof: encrypted
blocks (counted in the stamp) and server-side changes are not in the client files.
--check exits 1 when the checked-in file differs from what the snapshot gives.
"""
import hashlib
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "addon" / "modules" / "recipe_cooldown_data.lua"
TABLES = ["SkillLine", "SkillLineAbility", "SpellEffect", "SpellMisc", "SpellCooldowns", "SpellCategories"]
CREATE_ITEM = 24
SKILL_CATEGORIES = (9, 11)


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def build(snapshot):
    manifest = json.loads(Path(str(snapshot) + ".manifest.json").read_text(encoding="utf-8"))
    actual = sha256(snapshot)
    if actual != manifest["sha256"]:
        raise SystemExit(f"snapshot sha256 {actual} does not match its manifest {manifest['sha256']}")
    encrypted = {t["table"]: t["encryptedBlocks"] for t in manifest["tables"] if t["table"] in TABLES}
    missing = [t for t in TABLES if t not in encrypted]
    if missing:
        raise SystemExit(f"snapshot lacks tables: {missing}")
    db = sqlite3.connect(f"file:{snapshot}?mode=ro", uri=True)

    def rows(table):
        return [json.loads(r[0]) for r in db.execute("select raw from client_rows where tbl = ? order by id", (table,))]

    lines = {r["ID"] for r in rows("SkillLine") if r["CategoryID"] in SKILL_CATEGORIES}
    makes = {r["SpellID"] for r in rows("SpellEffect") if r["Effect"] == CREATE_ITEM and r["EffectItemType"] > 0}
    misc = {r["SpellID"] for r in rows("SpellMisc")}
    covered = sorted({r["Spell"] for r in rows("SkillLineAbility") if r["SkillLine"] in lines and r["Spell"] in makes
                      and r["Spell"] in misc})
    coveredSet = set(covered)
    limited = {}
    for r in rows("SpellCooldowns"):
        if r["SpellID"] in coveredSet and r["DifficultyID"] == 0:
            ms = max(r["RecoveryTime"], r["CategoryRecoveryTime"])
            if ms > 0:
                limited[r["SpellID"]] = {"ms": max(ms, limited.get(r["SpellID"], {}).get("ms", 0))}
    for r in rows("SpellCategories"):
        if r["SpellID"] in limited and r["DifficultyID"] == 0 and r["Category"] > 0:
            limited[r["SpellID"]]["category"] = r["Category"]
    return manifest, actual, encrypted, covered, limited


def render(snapshot, manifest, digest, encrypted, covered, limited):
    out = [
        "-- Recipe cooldowns from the game files; found in game files, unconfirmed. Generated: do not edit.",
        f"-- Regenerate with: python scripts/build-recipe-cooldowns.py <{Path(snapshot).name}>",
        "-- covered: recipe spells the client files list for a trade skill. limited: covered spells with a cooldown",
        "-- (milliseconds) and their shared cooldown category. A covered spell without a limited entry has no cooldown",
        "-- recorded in these files; encrypted blocks and server changes are not in them. Valid for `build` only.",
        "local E = Everloot",
        "E.RECIPE_COOLDOWNS = {",
        f'  build = "{manifest["version"]}",',
        f'  buildConfig = "{manifest["buildConfig"]}",',
        f'  snapshot = "{Path(snapshot).name}",',
        f'  sha256 = "{digest}",',
        f'  extractor = "{manifest["library"]}",',
        f'  definitions = "{manifest["definitions"]}",',
        '  generator = "scripts/build-recipe-cooldowns.py",',
        "  encrypted = { " + ", ".join(f"{t} = {encrypted[t]}" for t in TABLES) + " },",
        "  limited = {",
    ]
    for spell in sorted(limited):
        entry = limited[spell]
        category = f", category = {entry['category']}" if "category" in entry else ""
        out.append(f"    [{spell}] = {{ ms = {entry['ms']}{category} }},")
    out.append("  },")
    out.append("  covered = {")
    for i in range(0, len(covered), 16):
        out.append("    " + ", ".join(str(n) for n in covered[i:i + 16]) + ",")
    out.append("  },")
    out.append("}")
    return "\n".join(out) + "\n"


def main():
    args = [a for a in sys.argv[1:] if a != "--check"]
    if len(args) != 1:
        raise SystemExit(__doc__)
    snapshot = Path(args[0])
    manifest, digest, encrypted, covered, limited = build(snapshot)
    text = render(snapshot, manifest, digest, encrypted, covered, limited)
    if "--check" in sys.argv:
        current = OUT.read_text(encoding="utf-8").replace("\r\n", "\n") if OUT.exists() else ""
        if current != text:
            print(f"{OUT.relative_to(ROOT)} differs from the snapshot; regenerate it")
            sys.exit(1)
        print(f"{OUT.relative_to(ROOT)} matches {snapshot.name}: {len(covered)} covered, {len(limited)} limited")
        return
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(covered)} covered, {len(limited)} limited, build {manifest['version']}")


if __name__ == "__main__":
    main()
