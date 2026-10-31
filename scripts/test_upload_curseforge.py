"""Exercise CurseForge upload metadata and the actual multipart request without uploading."""
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("upload_curseforge", Path(__file__).with_name("upload-curseforge.py"))
upload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upload)


class UploadTests(unittest.TestCase):
    def test_alpha_and_stable_use_the_release_notes_channel(self):
        for notes, channel in [("Release channel: Alpha\nPending live checks.", "alpha"), ("Stable fixes.", "release")]:
            data = upload.metadata("0.3.14", notes)
            self.assertEqual(data["releaseType"], channel)
            self.assertEqual(data["gameVersions"], [17053])
            self.assertEqual(data["changelog"], notes)
            self.assertEqual(data["changelogType"], "markdown")

    def test_multipart_preserves_the_zip_and_uses_header_auth(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / "Everloot-0.3.14.zip"
            content = b"PK\x03\x04\x00\xff\r\nexact archive bytes"
            archive.write_bytes(content)
            class Response:
                def __enter__(self): return self
                def __exit__(self, *args): pass
                def read(self): return b'{"id": 12345}'
            with patch.dict(os.environ, {"CF_API_KEY": "private-test-token"}), patch.object(upload, "urlopen", return_value=Response()) as send:
                self.assertEqual(upload.publish(archive, upload.metadata("0.3.14", "Release channel: Alpha")), 12345)
            request = send.call_args.args[0]
            self.assertEqual(request.full_url, "https://wow.curseforge.com/api/projects/1762765/upload-file")
            self.assertEqual(request.get_method(), "POST")
            self.assertEqual(request.get_header("X-api-token"), "private-test-token")
            self.assertIn(content, request.data)
            self.assertIn(b'name="metadata"', request.data)
            self.assertIn(b'filename="Everloot-0.3.14.zip"', request.data)
            self.assertNotIn(b"private-test-token", request.data)

    def test_missing_secret_never_sends(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(upload, "urlopen") as send:
            with self.assertRaisesRegex(ValueError, "CF_API_KEY"):
                upload.publish(Path("missing.zip"), {})
            send.assert_not_called()

    def test_network_failure_propagates_without_retry(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / "Everloot-0.3.14.zip"
            archive.write_bytes(b"PK")
            with patch.dict(os.environ, {"CF_API_KEY": "test"}), patch.object(upload, "urlopen", side_effect=OSError("offline")) as send:
                with self.assertRaises(OSError): upload.publish(archive, {})
                self.assertEqual(send.call_count, 1)

    def test_nightly_version_is_rejected(self):
        with self.assertRaises(ValueError): upload.metadata("0.3.14-nightly.1", "notes")


if __name__ == "__main__":
    unittest.main()
