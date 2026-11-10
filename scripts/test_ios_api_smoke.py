"""Public API contracts required by the first iOS release (no network)."""
import unittest

from ios_api_smoke import check_response, run_checks


class IosApiSmokeTests(unittest.TestCase):
    def test_search_keeps_game_id_separate_from_archive_id(self):
        body = {"tool": "search_knowledge", "answer": {"hits": [{
            "recordId": 1080002589, "gameId": 2589, "kind": "item",
            "sourceUrl": "https://everloot.app/database/items/2589",
            "sourceKind": "observed", "retrievedAt": "2026-11-10T21:00:00Z",
            "licence": "CC-BY-SA-4.0",
        }]}, "text": "Linen Cloth"}
        self.assertEqual(check_response("search_knowledge", body), [])
        del body["answer"]["hits"][0]["gameId"]
        self.assertIn("gameId", " ".join(check_response("search_knowledge", body)))

    def test_lore_hit_does_not_need_a_game_id(self):
        hit = {"recordId": 2, "kind": "lore", "sourceKind": "lore",
               "sourceUrl": "https://warcraft.wiki.gg/wiki/Test",
               "retrievedAt": "2023-11-13T00:00:00Z", "licence": "CC-BY-SA-4.0"}
        self.assertEqual(check_response("search_knowledge", {
            "tool": "search_knowledge", "answer": {"hits": [hit]}, "text": "Archive"}), [])

    def test_unconfirmed_entity_is_valid_but_disconnected_is_not_ready(self):
        body = {"tool": "npc_page", "answer": {"connected": True,
                "dataAsOf": "2026-11-10T21:00:00Z", "page": {"npcId": 639, "name": None}},
                "text": "No agreed name yet."}
        self.assertEqual(check_response("npc_page", body), [])
        body["answer"]["connected"] = False
        self.assertIn("disconnected", " ".join(check_response("npc_page", body)))

    def test_empty_evidence_is_valid_and_unsourced_claim_is_rejected(self):
        body = {"tool": "answer_sources", "answer": {"evidence": []}, "text": "Unrecorded"}
        self.assertEqual(check_response("answer_sources", body), [])
        body["answer"]["evidence"] = [{"claim": "Something drops"}]
        self.assertIn("source", " ".join(check_response("answer_sources", body)))

    def test_unknown_evidence_date_is_preserved_as_unknown(self):
        piece = {"claim": "A sourced fact", "kind": "curated", "licence": "CC BY-SA 4.0",
                 "source": {"url": "https://everloot.app/database/items/2589"}, "asOf": None}
        body = {"tool": "answer_sources", "answer": {"evidence": [piece]}, "text": "A sourced fact"}
        self.assertEqual(check_response("answer_sources", body), [])
        del piece["asOf"]
        self.assertIn("asOf", " ".join(check_response("answer_sources", body)))

    def test_wrong_tool_or_html_cannot_pass(self):
        self.assertTrue(check_response("item_page", "<html>Challenge</html>"))
        self.assertTrue(check_response("item_page", {"tool": "quest_page", "answer": {}, "text": ""}))

    def test_http_failure_does_not_stop_other_checks_or_leak_error_body(self):
        calls = []

        def fetch(path):
            calls.append(path)
            raise RuntimeError("private upstream details")

        results = run_checks(fetch)
        self.assertGreater(len(calls), 5)
        self.assertTrue(all(not result["ok"] for result in results))
        self.assertNotIn("private upstream", str(results))

    def test_known_item_cannot_pass_with_empty_search_or_the_wrong_detail(self):
        def fetch(path):
            if "search_knowledge" in path:
                return {"tool": "search_knowledge", "answer": {"hits": []}, "text": "No hits"}
            return {"tool": "item_page", "answer": {"connected": True,
                    "dataAsOf": "2026-11-10T21:00:00Z", "page": {"itemId": 25}}, "text": "Wrong item"}

        results = run_checks(fetch)
        self.assertFalse(results[1]["ok"], "Linen Cloth must resolve to gameId 2589")
        self.assertFalse(results[3]["ok"], "An item 2589 request must return item 2589")

    def test_no_match_probe_rejects_unrelated_results(self):
        def fetch(path):
            return {"tool": "search_knowledge", "answer": {"hits": [{
                "recordId": 2, "kind": "lore_page", "sourceKind": "lore",
                "sourceUrl": "https://warcraft.wiki.gg/wiki/Test",
                "retrievedAt": "2023-11-13", "licence": "CC-BY-SA-4.0",
            }]}, "text": "Unrelated lore"}

        self.assertFalse(run_checks(fetch)[2]["ok"])


if __name__ == "__main__":
    unittest.main()
