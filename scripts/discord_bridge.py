"""Links the Everloot Discord server and this repository. Run by .github/workflows/discord-bridge.yml.

  schedule, issues  new #bug-reports posts become GitHub issues; issue status flows back to the post
                    as a tag and a reply; #known-issues lists open issues labelled known-issue
  release           posts an addon or desktop release to #updates, once. Releases made with the workflow
                    token start no workflows, so the release workflows also dispatch this one with
                    release_tag; whichever arrives second finds the post and skips it
  discussion        posts the new discussion to #discussions
  push to main      posts the commits to #github-feed
  pull_request_target (opened)  posts the pull request to #github-feed

Nothing here runs code from a pull request: the workflow checks out the base branch, and every title,
body and name is treated as text. Bot messages never ping anyone except the addon-release role.
Needs DISCORD_BOT_TOKEN, GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_NAME and GITHUB_EVENT_PATH.
Run the tests: python scripts/test_discord_bridge.py"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

GUILD = "1561174605580992603"
BUGS = "1561179041204150272"  # forum #bug-reports
KNOWN_ISSUES = "1561179153322082497"
VERSION_UPDATES = "1561179149702398044"
DISCUSSIONS = "1561254298170556589"
GITHUB_FEED = "1561179069083680868"
PING_ADDON = "1561178952108613752"
GOLD = 0xF2B632

AREA_LABELS = {"Addon": "addon", "Website": "web", "MCP / AI": "mcp", "Desktop": "companion"}
STATUS_TAGS = ("Tracked", "Confirmed", "Fixed", "Can't reproduce", "Needs info", "Closed")
REPORTS_PER_DAY = 3
MARKER = re.compile(r"<!-- discord-thread:(\d+) -->")
BRIDGE_LOGIN = "github-actions[bot]"
NO_PINGS = {"parse": []}


# ---------------------------------------------------------------- pure helpers (tested)

def snowflake_time(snowflake: str) -> datetime:
    return datetime.fromtimestamp(((int(snowflake) >> 22) + 1420070400000) / 1000, timezone.utc)


def defuse_mentions(text: str) -> str:
    """Discord text goes into a public issue; '@name' must not notify a GitHub user."""
    return re.sub(r"@(?=[A-Za-z0-9-])", "@​", text)


def issue_status(issue: dict) -> str:
    """The forum tag a bridged issue should show."""
    labels = {label["name"] for label in issue.get("labels", [])}
    if issue["state"] == "closed":
        if issue.get("state_reason") == "completed":
            return "Fixed"
        return "Can't reproduce" if "cant-reproduce" in labels else "Closed"
    if "needs-info" in labels:
        return "Needs info"
    if "confirmed" in labels:
        return "Confirmed"
    return "Tracked"


def status_reply(status: str, issue: dict) -> str:
    url = issue["html_url"]
    return {
        "Tracked": f"Tracked on GitHub: {url}",
        "Confirmed": f"A maintainer confirmed this bug: {url}",
        "Needs info": f"A maintainer needs more detail. Please answer here or on {url}",
        "Fixed": f"Fixed on GitHub: {url}\nThe fix ships with the next release; watch <#{VERSION_UPDATES}>.",
        "Can't reproduce": f"We couldn't reproduce this one, so the issue is closed: {url}\nReply here if it still happens.",
        "Closed": f"Closed on GitHub without a fix (usually a duplicate or not a bug): {url}",
    }[status]


def is_bridged(issue: dict) -> bool:
    """Only issues the bridge opened may drive a Discord post; anyone can open an issue with a marker."""
    labels = {label["name"] for label in issue.get("labels", [])}
    return issue.get("user", {}).get("login") == BRIDGE_LOGIN and "from-discord" in labels and bool(MARKER.search(issue.get("body") or ""))


def issue_body(thread: dict, starter: dict, areas: list[str]) -> str:
    author = starter["author"].get("global_name") or starter["author"]["username"]
    link = f"https://discord.com/channels/{GUILD}/{thread['id']}"
    text = defuse_mentions(starter.get("content") or "(no text)")
    quoted = "\n".join("> " + line for line in text.splitlines()) or "> (no text)"
    lines = [f"Reported on Discord by **{defuse_mentions(author)}** in #bug-reports: {link}", "", quoted, ""]
    if areas:
        lines.append("Area: " + ", ".join(areas))
    for a in starter.get("attachments", []):
        lines.append(f"Attachment: [{a['filename']}]({a['url']}) (Discord link, expires after a day)")
    lines += ["", "Opened automatically by the Discord bridge. Reply on GitHub; status changes are posted back to Discord.",
              f"<!-- discord-thread:{thread['id']} -->"]
    return "\n".join(lines)


def over_daily_limit(thread: dict, tracked: list[dict], now: datetime) -> bool:
    since = now - timedelta(days=1)
    mine = [t for t in tracked if t["owner_id"] == thread["owner_id"] and snowflake_time(t["id"]) >= since]
    return len(mine) >= REPORTS_PER_DAY


def known_issues_text(issues: list[dict]) -> str:
    if not issues:
        return "No known issues right now. Found one? Post it in <#%s>." % BUGS
    rows = []
    for i in issues[:25]:
        areas = [k for k, v in AREA_LABELS.items() if v in {label["name"] for label in i["labels"]}]
        rows.append(f"• [{i['title'][:90]}]({i['html_url']})" + (f" · {', '.join(areas)}" if areas else ""))
    more = len(issues) - 25
    if more > 0:
        rows.append(f"…and {more} more on GitHub.")
    return "\n".join(rows)


ANNOUNCED_TAG = re.compile(r"(addon|desktop)-v[0-9][0-9A-Za-z.-]*")


def announces_release(tag: str) -> bool:
    """Addon and desktop releases go to #updates; nightly builds and the protocol package don't."""
    return bool(ANNOUNCED_TAG.fullmatch(tag or ""))


def already_posted(tag: str, messages: list[dict], me: str) -> bool:
    return any(m["author"]["id"] == me and any((e.get("footer") or {}).get("text") == tag for e in m.get("embeds") or [])
               for m in messages)


def feed_commits(commits: list[dict]) -> list[str]:
    """One line per commit, skipping the automatic data refreshes that land every half hour."""
    out = []
    for c in commits:
        subject = c["message"].splitlines()[0][:100]
        if subject.startswith("Changes: refresh"):
            continue
        out.append(f"[`{c['id'][:7]}`]({c['url']}) {subject} · {c['author'].get('username') or c['author']['name']}")
    return out


def feed_pull_request(pr: dict) -> bool:
    return not pr["head"]["ref"].startswith("data/")


# ---------------------------------------------------------------- HTTP

def _request(url: str, method: str, headers: dict, body=None):
    data = None if body is None else json.dumps(body).encode()
    for _ in range(5):
        req = urllib.request.Request(url, data=data, method=method, headers={**headers, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                raw = res.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(float(json.loads(e.read() or b"{}").get("retry_after", 1)) + 0.2)
                continue
            raise RuntimeError(f"{method} {url} -> {e.code} {e.read()[:300]!r}") from None
    raise RuntimeError(f"{method} {url} -> still rate limited")


def discord(method: str, path: str, body=None):
    return _request("https://discord.com/api/v10" + path, method, {
        "Authorization": "Bot " + os.environ["DISCORD_BOT_TOKEN"],
        "User-Agent": "DiscordBot (https://github.com/Everloot/everloot, 1)",
    }, body)


def github(method: str, path: str, body=None):
    return _request("https://api.github.com" + path, method, {
        "Authorization": "Bearer " + os.environ["GITHUB_TOKEN"],
        "Accept": "application/vnd.github+json",
        "User-Agent": "everloot-discord-bridge",
    }, body)


def say(channel: str, embed: dict, content: str = "", roles=()) -> dict:
    body = {"embeds": [{"color": GOLD, **embed}], "allowed_mentions": {"parse": [], "roles": list(roles)}}
    if content:
        body["content"] = content
    return discord("POST", f"/channels/{channel}/messages", body)


# ---------------------------------------------------------------- jobs

REPO = os.environ.get("GITHUB_REPOSITORY", "Everloot/everloot")


def forum_tags() -> dict:
    return {t["name"]: t["id"] for t in discord("GET", f"/channels/{BUGS}")["available_tags"]}


def bug_threads() -> list[dict]:
    active = discord("GET", f"/guilds/{GUILD}/threads/active")["threads"]
    archived = discord("GET", f"/channels/{BUGS}/threads/archived/public?limit=50")["threads"]
    seen, out = set(), []
    for t in active + archived:
        if t["parent_id"] == BUGS and t["id"] not in seen:
            seen.add(t["id"])
            out.append(t)
    return out


def bridged_issues(since_days: int) -> list[dict]:
    since = (datetime.now(timezone.utc) - timedelta(days=since_days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    issues = github("GET", f"/repos/{REPO}/issues?labels=from-discord&state=all&since={since}&per_page=100")
    return [i for i in issues if "pull_request" not in i and is_bridged(i)]


def open_new_reports(tags: dict) -> None:
    me = discord("GET", "/users/@me")["id"]
    status_ids = {tags[s] for s in STATUS_TAGS if s in tags}
    threads = bug_threads()
    already = {MARKER.search(i["body"]).group(1) for i in bridged_issues(30)}
    tracked = [t for t in threads if status_ids & set(t.get("applied_tags", []))]
    now = datetime.now(timezone.utc)
    for t in sorted(threads, key=lambda t: int(t["id"])):
        if t["owner_id"] == me or status_ids & set(t.get("applied_tags", [])):
            continue
        if t["id"] in already:  # issue exists but tagging failed last time: just tag it
            discord("PATCH", f"/channels/{t['id']}", {"archived": False, "applied_tags": t.get("applied_tags", []) + [tags["Tracked"]]})
            continue
        if over_daily_limit(t, tracked, now):
            recent = discord("GET", f"/channels/{t['id']}/messages?limit=20")
            if not any(m["author"]["id"] == me for m in recent):
                discord("POST", f"/channels/{t['id']}/messages", {"allowed_mentions": NO_PINGS,
                        "content": f"You've posted {REPORTS_PER_DAY} bug reports in the last day, so this one goes to GitHub tomorrow. Thanks for testing so much!"})
            continue
        starter = discord("GET", f"/channels/{t['id']}/messages/{t['id']}")
        names = {v: k for k, v in tags.items()}
        areas = [names[x] for x in t.get("applied_tags", []) if names.get(x) in AREA_LABELS]
        labels = ["bug", "from-discord", "needs-triage"] + [AREA_LABELS[a] for a in areas]
        issue = github("POST", f"/repos/{REPO}/issues", {"title": defuse_mentions(t["name"])[:200],
                                                         "body": issue_body(t, starter, areas), "labels": labels})
        discord("PATCH", f"/channels/{t['id']}", {"archived": False, "applied_tags": (t.get("applied_tags", []) + [tags["Tracked"]])[:5]})
        discord("POST", f"/channels/{t['id']}/messages", {"allowed_mentions": NO_PINGS, "content": status_reply("Tracked", issue)})
        tracked.append(t)
        print(f"thread {t['id']} -> issue #{issue['number']}")


def sync_status(issue: dict, tags: dict) -> None:
    thread_id = MARKER.search(issue["body"]).group(1)
    try:
        thread = discord("GET", f"/channels/{thread_id}")
    except RuntimeError as e:
        print(f"issue #{issue['number']}: thread {thread_id} is gone ({e})")
        return
    want = issue_status(issue)
    status_ids = {tags[s] for s in STATUS_TAGS}
    keep = [x for x in thread.get("applied_tags", []) if x not in status_ids]
    if [x for x in thread.get("applied_tags", []) if x in status_ids] == [tags[want]]:
        return
    discord("PATCH", f"/channels/{thread_id}", {"archived": False, "applied_tags": (keep + [tags[want]])[:5]})
    discord("POST", f"/channels/{thread_id}/messages", {"allowed_mentions": NO_PINGS, "content": status_reply(want, issue)})
    print(f"issue #{issue['number']}: thread {thread_id} -> {want}")


def update_known_issues() -> None:
    issues = [i for i in github("GET", f"/repos/{REPO}/issues?labels=known-issue&state=open&per_page=100") if "pull_request" not in i]
    embed = {"title": "Known issues", "url": f"https://github.com/{REPO}/issues?q=is%3Aopen+label%3Aknown-issue",
             "description": known_issues_text(issues), "color": GOLD,
             "footer": {"text": "Updated automatically from GitHub issues labelled known-issue"}}
    me = discord("GET", "/users/@me")["id"]
    mine = [m for m in discord("GET", f"/channels/{KNOWN_ISSUES}/messages?limit=20") if m["author"]["id"] == me]
    if mine:
        old = mine[0]["embeds"][0] if mine[0]["embeds"] else {}
        if old.get("description") != embed["description"]:
            discord("PATCH", f"/channels/{KNOWN_ISSUES}/messages/{mine[0]['id']}", {"embeds": [embed], "allowed_mentions": NO_PINGS})
    else:
        discord("POST", f"/channels/{KNOWN_ISSUES}/messages", {"embeds": [embed], "allowed_mentions": NO_PINGS})


def post_release(release: dict) -> None:
    tag = release["tag_name"]
    if not announces_release(tag):
        print(f"{tag}: not announced in Discord")
        return
    me = discord("GET", "/users/@me")["id"]
    if already_posted(tag, discord("GET", f"/channels/{VERSION_UPDATES}/messages?limit=50"), me):
        print(f"{tag}: already in #updates")
        return
    addon = tag.startswith("addon-")
    msg = say(VERSION_UPDATES, {"title": release.get("name") or tag, "url": release["html_url"],
                                "description": (release.get("body") or "")[:3500], "footer": {"text": tag}},
              content=f"<@&{PING_ADDON}>" if addon else "", roles=[PING_ADDON] if addon else [])
    try:
        discord("POST", f"/channels/{VERSION_UPDATES}/messages/{msg['id']}/crosspost")
    except RuntimeError as e:
        print(f"crosspost: {e}")


def post_discussion(d: dict) -> None:
    say(DISCUSSIONS, {"title": d["title"][:250], "url": d["html_url"], "description": (d.get("body") or "")[:500],
                      "author": {"name": d["user"]["login"]}, "footer": {"text": d["category"]["name"]}})


def post_push(event: dict) -> None:
    lines = feed_commits(event.get("commits", []))
    if lines:
        say(GITHUB_FEED, {"title": f"{len(lines)} new commit{'s' if len(lines) > 1 else ''} on main",
                          "url": event["compare"], "description": "\n".join(lines)[:4000]})


def post_pull_request(pr: dict) -> None:
    if feed_pull_request(pr):
        say(GITHUB_FEED, {"title": f"#{pr['number']} {pr['title']}"[:250], "url": pr["html_url"],
                          "description": ("Draft pull request" if pr.get("draft") else "New pull request") + f" by {pr['user']['login']}"})


def main() -> None:
    name = os.environ["GITHUB_EVENT_NAME"]
    with open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8") as f:
        event = json.load(f)
    tag = os.environ.get("RELEASE_TAG", "")
    if name == "release":
        post_release(event["release"])
    elif name == "workflow_dispatch" and tag:
        if not announces_release(tag):
            raise RuntimeError(f"release_tag {tag!r} is not an addon-v* or desktop-v* tag")
        post_release(github("GET", f"/repos/{REPO}/releases/tags/{tag}"))
    elif name == "discussion":
        post_discussion(event["discussion"])
    elif name == "push":
        post_push(event)
    elif name == "pull_request_target":
        post_pull_request(event["pull_request"])
    elif name == "issues":
        tags = forum_tags()
        if is_bridged(event["issue"]):
            sync_status(event["issue"], tags)
        update_known_issues()
    else:  # schedule, workflow_dispatch
        tags = forum_tags()
        open_new_reports(tags)
        for issue in bridged_issues(2):
            sync_status(issue, tags)
        update_known_issues()


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        print(e, file=sys.stderr)
        sys.exit(1)
