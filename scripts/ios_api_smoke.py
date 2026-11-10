"""Read-only release smoke check for the public services used by Everloot iOS.

Run: python scripts/ios_api_smoke.py
Uses only the standard library, public URLs, and no credentials.
"""
import json
import sys
import urllib.error
import urllib.request
import urllib.parse
from datetime import datetime, timezone


CASES = [
    ("health", "/api/health"),
    ("search_knowledge", "/api/tools/search_knowledge?query=linen&kind=item&limit=3"),
    ("search_knowledge", "/api/tools/search_knowledge?query=qzxvjknotarecord937146&limit=1"),
    ("item_page", "/api/tools/item_page?itemId=2589"),
    ("npc_page", "/api/tools/npc_page?npcId=639"),
    ("quest_page", "/api/tools/quest_page?questId=1"),
    ("answer_sources", "/api/tools/answer_sources?question=Where%20does%20Linen%20Cloth%20drop%3F&limit=2"),
    ("coverage", "/api/tools/coverage"),
]


def check_response(tool, body):
    """Return contract failures; empty evidence and unconfirmed names are valid."""
    if not isinstance(body, dict):
        return ["Expected a JSON object, not an HTML challenge or other content."]
    if tool == "health":
        return [] if body.get("ok") is True and body.get("snapshot", {}).get("status") == "fresh" else ["Snapshot is not fresh."]
    if body.get("tool") != tool or not isinstance(body.get("text"), str) or not isinstance(body.get("answer"), dict):
        return ["Missing tool, text, or structured answer envelope."]
    answer = body["answer"]
    errors = []
    if tool == "search_knowledge":
        hits = answer.get("hits")
        if not isinstance(hits, list):
            return ["Missing search hits list."]
        for hit in hits:
            if not isinstance(hit, dict):
                errors.append("Malformed search hit.")
                continue
            for field in ("recordId", "sourceUrl", "sourceKind", "retrievedAt", "licence"):
                if not hit.get(field):
                    errors.append(f"Search hit missing {field}.")
            if hit.get("kind") in ("item", "npc", "quest") and (type(hit.get("gameId")) is not int or hit["gameId"] <= 0):
                errors.append("Gameplay hit missing a verified positive gameId.")
    elif tool == "answer_sources":
        evidence = answer.get("evidence")
        if not isinstance(evidence, list):
            return ["Missing evidence list."]
        for piece in evidence:
            if not isinstance(piece, dict):
                errors.append("Malformed evidence.")
                continue
            source = piece.get("source")
            if not isinstance(source, dict) or not source.get("url"):
                errors.append("Evidence missing source URL.")
            for field in ("claim", "kind", "licence"):
                if not piece.get(field):
                    errors.append(f"Evidence missing {field}.")
            if "asOf" not in piece or (piece["asOf"] is not None and not isinstance(piece["asOf"], str)):
                errors.append("Evidence missing a nullable asOf date.")
    else:
        if answer.get("connected") is not True:
            errors.append("Public observations are disconnected.")
        if not answer.get("dataAsOf"):
            errors.append("Missing observation timestamp.")
        page = answer.get("page")
        if not isinstance(page, dict):
            return errors + ["Missing entity page."]
        id_field = {"item_page": "itemId", "npc_page": "npcId", "quest_page": "questId"}.get(tool)
        if id_field and (type(page.get(id_field)) is not int or page[id_field] <= 0):
            errors.append(f"Missing positive {id_field}.")
        if tool == "coverage" and (page.get("measured") is not True or not page.get("build")):
            errors.append("Coverage is not measured against a named build.")
    return errors


def fetch_public(path):
    request = urllib.request.Request("https://everloot.app" + path, headers={
        "Accept": "application/json", "User-Agent": "Everloot-iOS-readiness/0.1",
    })
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def run_checks(fetch=fetch_public):
    results = []
    for tool, path in CASES:
        try:
            body = fetch(path)
            errors = check_response(tool, body)
            if not errors:
                query = urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)
                answer = body.get("answer", {})
                if tool == "search_knowledge" and query.get("query") == ["linen"]:
                    if not any(hit.get("gameId") == 2589 for hit in answer["hits"]):
                        errors.append("Known item Linen Cloth did not resolve to gameId 2589.")
                if tool == "search_knowledge" and query.get("query") == ["qzxvjknotarecord937146"] and answer["hits"]:
                    errors.append("No-match query returned unrelated records.")
                id_field = {"item_page": "itemId", "npc_page": "npcId", "quest_page": "questId"}.get(tool)
                if id_field and answer["page"][id_field] != int(query[id_field][0]):
                    errors.append("Returned entity does not match the requested game ID.")
        except urllib.error.HTTPError as error:
            errors = [f"HTTP {error.code}; check public client access or quota."]
        except Exception as error:
            errors = [f"Request failed ({type(error).__name__})."]
        results.append({"path": path, "ok": not errors, "errors": errors})
    return results


if __name__ == "__main__":
    results = run_checks()
    print(json.dumps({"checkedAt": datetime.now(timezone.utc).isoformat(), "checks": results}, indent=2))
    sys.exit(0 if all(result["ok"] for result in results) else 1)
