"""Validate the rows the addon writes against the protocol's JSON Schema files.

A helper, not a test. The contract tests call `check_all(lua)` after their own assertions, so a row
the addon produces that the site would refuse fails here, naming the kind, the row and the path.
The schema files are `packages/protocol/schema/records/<kind>.json` (or `EVERLOOT_PROTOCOL_SCHEMA`),
which Lua cannot read from an npm package, so this is the addon's link to the contract.
"""
import json
import os
from pathlib import Path

from jsonschema import Draft202012Validator

SCHEMA_DIR = Path(os.environ.get("EVERLOOT_PROTOCOL_SCHEMA") or Path(__file__).parents[2] / "packages" / "protocol" / "schema")

# Kinds the addon writes that never leave the computer: no uploader sends them (web/src/lib/upload-batches.ts
# LOCAL_ONLY_KINDS) and the intake has no schema for them, by design. owned_contract.py checks their shape.
LOCAL_ONLY_KINDS = {"profession_owned", "lockout_owned"}

_validators = {}


def schema_for(kind):
    """The validator for one kind; raises if the protocol has no such kind."""
    if kind not in _validators:
        path = SCHEMA_DIR / "records" / f"{kind}.json"
        assert path.exists(), f"the protocol has no record kind {kind!r} ({path})"
        _validators[kind] = Draft202012Validator(json.loads(path.read_text(encoding="utf-8")))
    return _validators[kind]


def to_plain(value):
    """A lupa table as plain Python, the way web/src/lib/sv-parse.ts `toPlain` reads a SavedVariables file.

    Keys exactly 1..n become a list; any other table becomes a dict with string keys; scalars pass through.
    """
    if not hasattr(value, "items"):
        return value
    items = list(value.items())
    if not items:
        return []
    keys = [k for k, _ in items]
    if all(isinstance(k, (int, float)) and float(k).is_integer() for k in keys):
        nums = sorted(int(k) for k in keys)
        if nums and nums[0] == 1 and nums == list(range(1, len(nums) + 1)):
            by_key = {int(k): v for k, v in items}
            return [to_plain(by_key[n]) for n in nums]
    return {str(k): to_plain(v) for k, v in items}


def check_rows(kind, rows, install_id):
    """Validate every row of one kind as the uploader would send it: `{kind, installId, ...row}`."""
    validator = schema_for(kind)
    for index, row in enumerate(rows):
        record = {"kind": kind, "installId": install_id, **row}
        errors = sorted(validator.iter_errors(record), key=lambda e: list(e.absolute_path))
        if errors:
            first = errors[0]
            path = "/".join(str(p) for p in first.absolute_path) or "(record)"
            raise AssertionError(f"{kind} row {index} is not a protocol {kind}: {path}: {first.message}")


def check_all(lua):
    """Validate every kind in the running addon's EverlootDB.records. Returns the counts per kind."""
    db = lua.globals().EverlootDB
    assert db is not None, "EverlootDB is not loaded"
    install_id = db.installId if isinstance(db.installId, str) else "test-install-1234"
    counts = {}
    records = db.records
    if records is None:
        return counts
    for kind, rows in records.items():
        plain = to_plain(rows)
        if plain == [] or kind in LOCAL_ONLY_KINDS:
            continue
        assert isinstance(plain, list), f"EverlootDB.records.{kind} is not a list"
        check_rows(kind, plain, install_id)
        counts[kind] = len(plain)
    return counts
