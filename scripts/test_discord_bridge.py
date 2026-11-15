"""Run: python scripts/test_discord_bridge.py"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))
from discord_bridge import (  # noqa: E402
    already_posted, announces_release, defuse_mentions, feed_commits, feed_pull_request, is_bridged, issue_body, issue_status,
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

# Releases: addon and desktop tags are announced, once; nightly builds and the protocol package are not.
assert announces_release("addon-v0.3.23") and announces_release("desktop-v0.1.22")
assert announces_release("addon-v0.4.0-beta.1")
assert not announces_release("nightly-20261115.37")
assert not announces_release("protocol-v2.2.0")
assert not announces_release("addon-v0.3.23/../../x") and not announces_release("") and not announces_release(None)
post = lambda tag, author="1": {"author": {"id": author}, "embeds": [{"title": "x", "footer": {"text": tag}}]}
assert already_posted("desktop-v0.1.22", [post("addon-v0.3.23"), post("desktop-v0.1.22")], "1")
assert not already_posted("desktop-v0.1.22", [post("desktop-v0.1.22", author="2")], "1")
assert not already_posted("desktop-v0.1.22", [post("desktop-v0.1.21"), {"author": {"id": "1"}, "embeds": []}], "1")
assert not already_posted("addon-v0.3.23", [{"author": {"id": "1"}, "content": "hi"}], "1")

print("discord_bridge: all tests passed")
