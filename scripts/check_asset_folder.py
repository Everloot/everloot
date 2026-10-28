"""Fail when the committed client layer's build has no uploaded asset folder.
The site shows item names, icons and tooltips only from the asset folder of the client layer's own build
(docs/ASSETS.md), so game data merged before its folder is uploaded turns every item into "Item N".
Run from the repository root: python scripts/check_asset_folder.py"""
import json
import sys
import urllib.error
import urllib.request

LAYER = "web/src/data/game-data/client-layer.json"
ASSETS = "https://assets.everloot.app"


def folder_of(build: dict) -> str:
    """The build folder name the uploader writes: <product>-<build id>-<first 8 of the build config>."""
    return f"{build['product']}-{build['buildId']}-{build['buildConfig'][:8]}"


def problems(build: dict, status: int, manifest: object) -> list[str]:
    """What is wrong with the folder for `build`, given the HTTP status and parsed body of its manifest.json."""
    folder = folder_of(build)
    if status != 200:
        return [f"{ASSETS}/{folder}/manifest.json answers {status}: the asset folder for build {build['version']} is not uploaded"]
    version = manifest.get("build", {}).get("version") if isinstance(manifest, dict) else None
    if version != build["version"]:
        return [f"{ASSETS}/{folder}/manifest.json is for build {version}, not {build['version']}"]
    return []


def fetch(url: str) -> tuple[int, object]:
    # The asset host refuses urllib's default user agent with a 403, as if the folder were missing.
    req = urllib.request.Request(url, headers={"User-Agent": "everloot-ci-asset-check"})
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as err:
        return err.code, None


def main() -> int:
    with open(LAYER, encoding="utf-8") as f:
        build = json.load(f)["build"]
    found = problems(build, *fetch(f"{ASSETS}/{folder_of(build)}/manifest.json"))
    for p in found:
        print(p)
    if found:
        print("\nUpload the build's assets and names first (docs/ASSETS.md, steps 6 to 8), then set the production")
        print(f"NEXT_PUBLIC_GAME_ASSETS_URL to {ASSETS}/{folder_of(build)} and rerun this check.")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
