"""Upload a tagged release's tested zip using the CurseForge Upload API.

API: https://support.curseforge.com/support/solutions/articles/9000197321-curseforge-api
The project's Forever 1.60.1 game version is 17053. Nightlies are never uploaded here.
"""
import argparse
import json
import os
import re
import sys
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def metadata(version: str, notes: str) -> dict:
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Only tagged addon versions may be uploaded")
    channel = "alpha" if "Release channel: Alpha" in notes.splitlines() else "release"
    return {"displayName": f"Everloot {version}" + (" Alpha" if channel == "alpha" else ""),
            "changelog": notes, "changelogType": "markdown", "gameVersions": [17053], "releaseType": channel}


def publish(archive: Path, data: dict) -> int:
    token = os.environ.get("CF_API_KEY", "").strip()
    if not token:
        raise ValueError("CF_API_KEY must be set")
    boundary = "everloot-" + uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n'
            'Content-Type: application/json\r\n\r\n').encode() + json.dumps(data).encode("utf-8")
    body += (f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{archive.name}"\r\n'
             'Content-Type: application/zip\r\n\r\n').encode() + archive.read_bytes()
    body += f"\r\n--{boundary}--\r\n".encode()
    request = Request("https://wow.curseforge.com/api/projects/1762765/upload-file", data=body,
                      headers={"X-Api-Token": token, "Content-Type": f"multipart/form-data; boundary={boundary}"})
    # Do not retry a POST: an interrupted response can still mean the file was uploaded.
    with urlopen(request, timeout=120) as response:
        result = json.loads(response.read())
    file_id = result.get("id")
    if type(file_id) is not int or file_id <= 0:
        raise ValueError("CurseForge did not return a file ID; check the project before retrying")
    return file_id


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version")
    args = parser.parse_args()
    try:
        data = metadata(args.version, Path("release-notes.md").read_text(encoding="utf-8"))
        file_id = publish(Path(f"Everloot-{args.version}.zip"), data)
    except HTTPError as error:
        print(f"CurseForge upload failed: HTTP {error.code}. Check the project before retrying.", file=sys.stderr)
        return 1
    except (OSError, URLError, ValueError) as error:
        print(f"CurseForge upload failed ({type(error).__name__}). Check configuration and the project before retrying.", file=sys.stderr)
        return 1
    print(f"CurseForge file {file_id}: {data['displayName']} ({data['releaseType']}, Forever 1.60.1)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
