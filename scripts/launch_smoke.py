"""The smoke list in docs/LAUNCH_DAY.md, as one command: every path is asked and judged, and a Markdown table is
printed for the step's record. Exits 1 when any check fails. Reads public pages only; the IndexNow key is checked
for presence and never printed.
Run from the repository root: python scripts/launch_smoke.py [--after-switch] [--origin https://everloot.app]
--after-switch: /beta must show the "None running" notice (after the launch switch, LAUNCH_DAY step 19)."""
import json
import re
import sys
import time
import urllib.error
import urllib.request

ORIGIN = "https://everloot.app"
MCP_TOOLS = 32  # counted 2026-10-30, docs/LAUNCH_DAY.md


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def fetch(url: str, body: dict | None = None) -> tuple[int, dict, str, float]:
    """Status, lower-cased headers, text and seconds. A redirect is returned as it is, not followed."""
    headers = {"User-Agent": "everloot-launch-smoke"}
    if body is not None:
        headers.update({"content-type": "application/json", "accept": "application/json, text/event-stream"})
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    opener = urllib.request.build_opener(NoRedirect)
    start = time.monotonic()
    try:
        with opener.open(req, timeout=30) as res:
            return res.status, {k.lower(): v for k, v in res.headers.items()}, res.read().decode("utf-8", "replace"), time.monotonic() - start
    except urllib.error.HTTPError as err:
        return err.code, {k.lower(): v for k, v in err.headers.items()}, err.read().decode("utf-8", "replace"), time.monotonic() - start
    except (urllib.error.URLError, TimeoutError) as err:
        return 0, {}, str(err), time.monotonic() - start


def title(html: str) -> str:
    m = re.search(r"<title>([^<]*)", html)
    return m.group(1).strip() if m else ""


def judge_ok(status: int, _headers: dict, _text: str) -> str | None:
    return None if status == 200 else f"answered {status}"


def judge_png(status: int, headers: dict, _text: str) -> str | None:
    """A link preview card: the picture itself, not an error page."""
    if status != 200:
        return f"answered {status}"
    kind = headers.get("content-type", "")
    return None if kind.split(";")[0].strip() == "image/png" else f"is {kind or 'untyped'}, not image/png"


def judge_notice(status: int, _headers: dict, text: str) -> str | None:
    """A version page with nothing running: 200, the notice, kept out of search results."""
    if status != 200:
        return f"answered {status}"
    if "None running" not in text:
        return 'does not say "None running"'
    if "noindex" not in text:
        return "is not marked noindex"
    return None


def judge_redirect(target: str):
    def judge(status: int, headers: dict, _text: str) -> str | None:
        location = headers.get("location", "")
        if status != 308:
            return f"answered {status}, not 308"
        return None if location.rstrip("/").endswith(target) else f"redirects to {location}, not {target}"
    return judge


def judge_health(status: int, _headers: dict, text: str) -> str | None:
    """The site answers 200 only while the snapshot is fresh (src/app/api/health/route.ts)."""
    if status != 200:
        return f"answered {status} (stale snapshot or unreadable storage)"
    try:
        body = json.loads(text)
    except ValueError:
        return "is not JSON"
    if body.get("ok") is not True:
        return "says ok is not true"
    return None


def judge_named_item(item: int):
    def judge(status: int, _headers: dict, text: str) -> str | None:
        if status != 200:
            return f"answered {status}"
        name = title(text)
        if not name or name.startswith(f"Item {item}"):
            return f'shows no item name (title "{name}"): is this build\'s name file uploaded?'
        return None
    return judge


def judge_indexnow(status: int, _headers: dict, text: str) -> str | None:
    if status != 200:
        return f"answered {status} (the IndexNow key setting may be missing)"
    return None if text.strip() else "is empty"


DOWNLOAD_FAILURES = ("not available on this site right now", "could not be loaded right now")


def judge_downloads(desktop: bool):
    """A download page links the served addon zip and, on /addon, a Desktop App installer; the fallback that
    sends players to GitHub instead counts as a miss (src/app/addon/page.tsx)."""
    def judge(status: int, _headers: dict, text: str) -> str | None:
        if status != 200:
            return f"answered {status}"
        failed = [phrase for phrase in DOWNLOAD_FAILURES if phrase in text]
        if failed:
            return f'says "{failed[0]}"'
        if not re.search(r'href="/downloads/Everloot-[0-9.]+\.zip"', text):
            return "links no addon zip"
        if desktop and not re.search(r'href="https://github\.com/Everloot/everloot/releases/download/desktop-v[0-9.]+/', text):
            return "links no Desktop App installer"
        return None
    return judge


def mcp_payload(text: str) -> dict | None:
    """The JSON-RPC answer, whether the endpoint sent plain JSON or one server-sent event."""
    for chunk in [text, *[line[5:] for line in text.splitlines() if line.startswith("data:")]]:
        try:
            return json.loads(chunk)
        except ValueError:
            continue
    return None


def judge_tools(expected: int):
    def judge(status: int, _headers: dict, text: str) -> str | None:
        if status != 200:
            return f"answered {status}" + (": the hourly allowance is used up" if status == 429 else "")
        tools = ((mcp_payload(text) or {}).get("result") or {}).get("tools")
        if not isinstance(tools, list):
            return "has no tool list"
        return None if len(tools) == expected else f"lists {len(tools)} tools, not {expected} (update MCP_TOOLS if a tool was added on purpose)"
    return judge


def judge_deadmines(status: int, _headers: dict, text: str) -> str | None:
    """The first piece is the game files' fact, naming each boss once."""
    if status != 200:
        return f"answered {status}"
    content = ((mcp_payload(text) or {}).get("result") or {}).get("content") or []
    answer = content[0].get("text", "") if content and isinstance(content[0], dict) else ""
    first = answer.split("\n- ")[0]
    if "game files" not in first or "Deadmines" not in first:
        return "the first piece is not the game files' Deadmines fact"
    names = re.search(r"bosses: ([^.]*)", first)
    if not names:
        return "the first piece names no bosses"
    bosses = [b.strip() for b in names.group(1).split(",")]
    return None if len(bosses) == len(set(bosses)) else "a boss is named more than once"


def checks(after_switch: bool) -> list[tuple[str, str, dict | None, object]]:
    """(label, path, JSON body for a POST or None, judge)."""
    beta = judge_notice if after_switch else judge_ok
    return [
        *[(p, p, None, judge_ok) for p in ["/", "/database", "/database/coverage", "/database/download", "/sitemap.xml", "/database-sitemap.xml"]],
        ("/beta", "/beta", None, beta),
        ("/beta/database/items/2589", "/beta/database/items/2589", None, beta),
        ("/ptr", "/ptr", None, judge_notice),
        ("/game-version/beta", "/game-version/beta", None, judge_redirect("/beta")),
        ("/game-version/ptr", "/game-version/ptr", None, judge_redirect("/ptr")),
        ("/api/health", "/api/health", None, judge_health),
        ("/database/items/25", "/database/items/25", None, judge_named_item(25)),
        ("/addon", "/addon", None, judge_downloads(desktop=True)),
        ("/upload", "/upload", None, judge_downloads(desktop=False)),
        ("/indexnow.txt", "/indexnow.txt", None, judge_indexnow),
        # The link previews of a shared talent build and a raid plan, drawn on each request (500 on the Worker until 11/01).
        ("talent build card", "/tools/talents/mage/card?a=EL1-mage-0-1.60.1.70707-MTA1ODE1OjE&b=-", None, judge_png),
        ("raid plan card", "/tools/raid/card?c=ELR1-10-1.60.1.70707-MTM1Mg", None, judge_png),
        ("MCP tools/list", "/mcp/public", {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, judge_tools(MCP_TOOLS)),
        ("MCP answer_sources: which bosses are in Deadmines", "/mcp/public",
         {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "answer_sources", "arguments": {"question": "which bosses are in Deadmines", "limit": 3}}},
         judge_deadmines),
    ]


def main(argv: list[str]) -> int:
    after_switch = "--after-switch" in argv
    origin = argv[argv.index("--origin") + 1].rstrip("/") if "--origin" in argv else ORIGIN
    print(f"Smoke list against {origin} ({'after' if after_switch else 'before'} the switch), {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}\n")
    print("| Check | Status | Seconds | Result |\n|---|---|---|---|")
    failed = 0
    for label, path, body, judge in checks(after_switch):
        status, headers, text, seconds = fetch(origin + path, body)
        problem = judge(status, headers, text)
        failed += problem is not None
        print(f"| `{label}` | {status} | {seconds:.2f} | {'ok' if problem is None else 'FAIL: ' + problem} |")
    print(f"\n{failed} of {len(checks(after_switch))} checks failed." if failed else "\nEvery check passed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
