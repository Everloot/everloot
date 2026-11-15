"""Run: python scripts/test_discord_bridge.py"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))
from discord_bridge import (  # noqa: E402
    defuse_mentions, feed_commits, feed_pull_request, is_bridged, issue_body, issue_status,
    known_issues_text, over_daily_limit, snowflake_time, status_reply,
)


def issue(state="open", labels=(), reason=None, login="github-actions[bot]", body="x <!-- discord-thread:123 -->"):
    return {"state": state, "state_reason": reason, "labels": [{"name": n} for n in labels],
            "user": {"login": login}, "body": body, "html_url": "https://github.com/Everloot/everloot/issues/9",
            "title": "Map pins vanish"}


# Status: labels and close reason decide the tag on the Discord post.
assert issue_status(issue()) == "Tracked"
assert issue_status(issue(labels=["from-discord", "confirmed"])) == "Confirmed"
assert issue_status(issue(labels=["confirmed", "needs-info"])) == "Needs info"
assert issue_status(issue("closed", reason="completed")) == "Fixed"
assert issue_status(issue("closed", ["cant-reproduce"], reason="not_planned")) == "Can't reproduce"
assert issue_status(issue("closed", ["duplicate"], reason="not_planned")) == "Closed"
assert issue_status(issue("closed", ["confirmed"], reason="completed")) == "Fixed"
for s in ("Tracked", "Confirmed", "Needs info", "Fixed", "Can't reproduce", "Closed"):
    assert "issues/9" in status_reply(s, issue())

# Only issues the bridge itself opened can change a Discord post.
assert is_bridged(issue(labels=["from-discord"]))
assert not is_bridged(issue(labels=["from-discord"], login="someone"))
assert not is_bridged(issue(labels=["bug"]))
assert not is_bridged(issue(labels=["from-discord"], body="no marker here"))
assert not is_bridged(issue(labels=["from-discord"], body=None))

# Discord text can't ping GitHub users or teams; e-mail-like text and lone @ stay readable.
assert defuse_mentions("thanks @octocat and @Everloot/maintainers") == "thanks @​octocat and @​Everloot/maintainers"
assert defuse_mentions("a @ b") == "a @ b"

# The issue body quotes the post, credits the reporter, links back and carries the marker.
thread = {"id": "1561300000000000000", "owner_id": "42", "name": "Map pins vanish"}
starter = {"author": {"username": "thrall", "global_name": "Thrall @everyone"}, "content": "Pins vanish\nafter /reload @octocat",
           "attachments": [{"filename": "shot.png", "url": "https://cdn.discordapp.com/a/shot.png"}]}
body = issue_body(thread, starter, ["Addon"])
assert "> Pins vanish\n> after /reload @​octocat" in body
assert "**Thrall @​everyone**" in body
assert "https://discord.com/channels/1561174605580992603/1561300000000000000" in body
assert "Area: Addon" in body and "[shot.png](https://cdn.discordapp.com/a/shot.png)" in body
assert body.rstrip().endswith("<!-- discord-thread:1561300000000000000 -->")
assert "> (no text)" in issue_body(thread, {"author": {"username": "u"}, "content": "", "attachments": []}, [])

# Snowflakes carry their creation time; three reports a day per person, older ones don't count.
assert snowflake_time("0") == datetime(2015, 1, 1, tzinfo=timezone.utc)
now = snowflake_time(thread["id"])
day = timedelta(days=1)


def at(t, owner="42"):
    ms = int((t.timestamp() * 1000) - 1420070400000)
    return {"id": str(ms << 22), "owner_id": owner}


recent = [at(now - timedelta(hours=h)) for h in (1, 2, 3)]
assert over_daily_limit(thread, recent, now)
assert not over_daily_limit(thread, recent[:2], now)
assert not over_daily_limit(thread, recent[:2] + [at(now - day - timedelta(hours=1))], now)
assert not over_daily_limit(thread, [at(now, "7")] * 5, now)

# Known issues: empty state, area names, and a cap of 25 rows.
assert "No known issues" in known_issues_text([])
row = {"title": "Upload stalls", "html_url": "https://x/1", "labels": [{"name": "web"}, {"name": "known-issue"}]}
assert known_issues_text([row]) == "• [Upload stalls](https://x/1) · Website"
assert known_issues_text([row] * 30).endswith("…and 5 more on GitHub.")

# Feed: the half-hourly data merges are skipped; data/ pull requests too.
c = lambda msg, user="CDVolvik": {"id": "abcdef1234", "url": "https://x/c", "message": msg, "author": {"name": "Carlos", "username": user}}
assert feed_commits([c("feat(web): talent tiles\n\nbody"), c("Changes: refresh blue posts and builds")]) == \
    ["[`abcdef1`](https://x/c) feat(web): talent tiles · CDVolvik"]
assert feed_commits([c("fix: x", user=None)]) == ["[`abcdef1`](https://x/c) fix: x · Carlos"]
assert not feed_pull_request({"head": {"ref": "data/changes"}})
assert feed_pull_request({"head": {"ref": "game-build/wow_classic-70450-1a2b3c4d"}})


# Scheduled release catch-up uses fake HTTP only; never send a real Discord post.
import json
import tempfile
from unittest.mock import patch
import discord_bridge as bridge

stamp = datetime.now(timezone.utc)
def release(tag, age=1, **extra):
    return {"tag_name": tag, "published_at": (stamp - timedelta(days=age)).isoformat(),
            "html_url": "https://github.com/Everloot/everloot/releases/tag/" + tag,
            "body": "Release notes", **extra}

releases = [release("addon-v1"), release("desktop-v1"), release("addon-v2"),
            release("addon-v3", prerelease=True), release("nightly-20261115"),
            release("addon-v4-nightly.1"), release("protocol-v1"),
            release("desktop-v0", age=8), release("desktop-vfuture", age=-1),
            release("desktop-vdraft", draft=True), release("addon-vbad", published_at=None)]
posted = []
reads = []
def fake_github(method, path, body=None):
    assert method == "GET", (method, path)
    reads.append(path)
    if path.endswith("page=1"): return releases + [release("addon-v1")] * (100 - len(releases))
    if path.endswith("page=2"): return [release("desktop-v2")]
    raise AssertionError(path)

def fake_discord(method, path, body=None):
    if method == "GET" and path == "/users/@me": return {"id": "bot"}
    if method == "GET" and "messages?" in path:
        if "before=" in path:
            return [{"id": "1", "author": {"id": "bot"}, "embeds": [{"footer": {"text": "desktop-v1"}}]}] + [
                {"id": "posted", "author": {"id": "bot"}, "embeds": p["embeds"]} for p in posted]
        return [{"id": str(200-i), "author": {"id": "other"},
                 "embeds": [{"footer": {"text": "addon-v2"}}]} for i in range(100)]
    if method == "POST" and path.endswith("/messages"):
        posted.append(body)
        return {"id": "new"}
    if method == "POST" and path.endswith("/crosspost"): return {}
    raise AssertionError((method, path))

with tempfile.NamedTemporaryFile(mode="w", suffix=".json") as event:
    json.dump({}, event); event.flush()
    with patch.dict(os.environ, GITHUB_EVENT_NAME="schedule", GITHUB_EVENT_PATH=event.name), \
         patch.object(bridge, "github", side_effect=fake_github), \
         patch.object(bridge, "discord", side_effect=fake_discord), \
         patch.object(bridge, "forum_tags", return_value={}), \
         patch.object(bridge, "open_new_reports"), \
         patch.object(bridge, "bridged_issues", return_value=[]), \
         patch.object(bridge, "update_known_issues"):
        bridge.main()
        bridge.main()  # A later sync sees the posted footers and sends nothing twice.
assert sorted(p["embeds"][0]["footer"]["text"] for p in posted) == ["addon-v1", "addon-v2", "desktop-v2"]
assert all(p["allowed_mentions"] == {"parse": [], "roles": []} and not p.get("content") for p in posted)
assert len(reads) == 4
print("discord_bridge: scheduled release catch-up tests passed")

# The seven-day boundary is inclusive; older and future dates do not backfill.
posted.clear()
boundaries = [release("addon-vboundary", age=7), release("desktop-vnow", age=0),
              release("addon-vexpired", published_at=(stamp-timedelta(days=7, seconds=1)).isoformat())]
with patch.object(bridge, "github", return_value=boundaries), \
     patch.object(bridge, "discord", side_effect=fake_discord):
    bridge.catch_up_releases(stamp)
assert sorted(p["embeds"][0]["footer"]["text"] for p in posted) == ["addon-vboundary", "desktop-vnow"]
# Direct release events retain the existing addon role notification.
posted.clear()
with patch.object(bridge, "discord", side_effect=fake_discord):
    bridge.post_release(release("addon-vdirect"))
assert posted[0]["content"] == f"<@&{bridge.PING_ADDON}>"
assert posted[0]["allowed_mentions"] == {"parse": [], "roles": [bridge.PING_ADDON]}
print("discord_bridge: all tests passed (including date boundaries and direct releases)")
