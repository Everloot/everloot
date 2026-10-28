"""Run: python scripts/test_check_asset_folder.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from check_asset_folder import folder_of, problems  # noqa: E402

build = {"product": "wowf", "buildId": 70658, "version": "1.60.1.70658", "buildConfig": "165410aca770316ea0f88100bb4830c2"}

# The folder is named the way the uploader names it.
assert folder_of(build) == "wowf-70658-165410ac"
# An uploaded folder for the same build passes.
assert problems(build, 200, {"build": {"version": "1.60.1.70658"}}) == []
# A missing folder fails, naming the build.
missing = problems(build, 404, None)
assert len(missing) == 1 and "1.60.1.70658" in missing[0] and "not uploaded" in missing[0]
# A folder whose manifest is for another build fails too.
other = problems(build, 200, {"build": {"version": "1.60.1.70634"}})
assert len(other) == 1 and "1.60.1.70634" in other[0]
# A body that is not a manifest fails rather than passing.
assert problems(build, 200, ["not", "a", "manifest"]) != []

print("check_asset_folder: all tests passed")
