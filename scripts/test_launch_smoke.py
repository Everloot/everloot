"""Run: python scripts/test_launch_smoke.py"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from launch_smoke import (  # noqa: E402
    checks, judge_deadmines, judge_downloads, judge_health, judge_named_item, judge_notice, judge_redirect, judge_tools, mcp_payload,
)

# A version page with nothing running needs the notice and noindex; before the switch /beta is any 200 page.
assert judge_notice(200, {}, '<meta name="robots" content="noindex, follow"/>None running.') is None
assert "None running" in judge_notice(200, {}, "<title>Beta</title>")
assert "noindex" in judge_notice(200, {}, "None running.")
before = {label: judge for label, _p, _b, judge in checks(False)}
after = {label: judge for label, _p, _b, judge in checks(True)}
assert before["/beta"](200, {}, "<title>Beta</title>") is None and after["/beta"](200, {}, "<title>Beta</title>") is not None
assert after["/ptr"] is judge_notice and before["/ptr"] is judge_notice

# A redirect must be a 308 to the right place, absolute or relative.
assert judge_redirect("/beta")(308, {"location": "https://everloot.app/beta"}, "") is None
assert judge_redirect("/beta")(308, {"location": "/beta"}, "") is None
assert "not 308" in judge_redirect("/beta")(301, {"location": "/beta"}, "")
assert "not /beta" in judge_redirect("/beta")(308, {"location": "/ptr"}, "")

# Health: 503 is stale or unreadable; a 200 must say ok.
assert judge_health(200, {}, '{"ok":true}') is None
assert "503" in judge_health(503, {}, '{"ok":false}')
assert judge_health(200, {}, "<html>") == "is not JSON"

# An item page must be named: "Item 25" means the build's names are not uploaded.
assert judge_named_item(25)(200, {}, "<title>Worn Shortsword – WoW Forever item · Everloot</title>") is None
assert "no item name" in judge_named_item(25)(200, {}, "<title>Item 25 · Everloot</title>")

# A download page links the zip (and on /addon an installer); the GitHub fallback is a miss.
zip_link = '<a href="/downloads/Everloot-0.3.14.zip">'
installer = '<a href="https://github.com/Everloot/everloot/releases/download/desktop-v0.1.10/Everloot-Setup.exe">'
assert judge_downloads(desktop=True)(200, {}, zip_link + installer) is None
assert judge_downloads(desktop=False)(200, {}, zip_link) is None
assert judge_downloads(desktop=True)(200, {}, zip_link) == "links no Desktop App installer"
assert judge_downloads(desktop=False)(200, {}, "<p>Download</p>") == "links no addon zip"
assert "not available" in judge_downloads(desktop=False)(200, {}, zip_link + "The addon download is not available on this site right now.")
assert "could not be loaded" in judge_downloads(desktop=True)(200, {}, zip_link + installer + "The download list could not be loaded right now.")
assert judge_downloads(desktop=False)(404, {}, "") == "answered 404"

# The MCP answers plain JSON or one server-sent event; the tool count is exact, and a 429 says why.
tools = {"jsonrpc": "2.0", "id": 1, "result": {"tools": [{"name": f"t{i}"} for i in range(32)]}}
assert mcp_payload(json.dumps(tools)) == tools
assert mcp_payload(f"event: message\ndata: {json.dumps(tools)}\n\n") == tools
assert judge_tools(32)(200, {}, json.dumps(tools)) is None
assert "lists 32 tools, not 33" in judge_tools(33)(200, {}, json.dumps(tools))
assert "allowance" in judge_tools(32)(429, {}, "")


def sources(text: str) -> str:
    return json.dumps({"result": {"content": [{"type": "text", "text": text}]}})


good = "- [game files, found in game files and unconfirmed] Deadmines: a dungeon; the files name 2 bosses: Rhahk'Zor, Sneed.\n  Source: x\n- [lore] Other"
assert judge_deadmines(200, {}, sources(good)) is None
assert "more than once" in judge_deadmines(200, {}, sources(good.replace("Rhahk'Zor, Sneed", "Sneed, Sneed")))
assert "not the game files" in judge_deadmines(200, {}, sources("- [lore] Welcome to the Deadmines: a song\n- [game files] Deadmines: ..."))

print("launch_smoke: all tests passed")
