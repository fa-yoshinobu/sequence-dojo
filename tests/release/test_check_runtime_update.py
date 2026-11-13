from http.client import IncompleteRead
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".github" / "scripts"))
import check_runtime_update as checker


def metadata(version="10.0.15"):
    return {"channel-version": "10.0", "releases": [
        {"runtime": {"version": "10.0.16-preview.1"}},
        {"runtime": {"version": version}},
        {"runtime": {"version": "10.0.9"}},
        {"runtime": {"version": "11.0.99"}},
    ]}


class RuntimeUpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name) / "App.csproj"
        self.project.write_text('<Project><PropertyGroup><RuntimeFrameworkVersion>10.0.14</RuntimeFrameworkVersion></PropertyGroup></Project>', encoding="utf-8")

    def run_checker(self, response):
        with patch.object(checker, "urlopen", return_value=io.BytesIO(json.dumps(response).encode())) as request, \
                patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": ""}), patch("sys.stdout", new_callable=io.StringIO) as output:
            code = checker.main(["--project", str(self.project)])
        self.assertEqual(request.call_args.args[0], "https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json")
        self.assertEqual(request.call_args.kwargs["timeout"], 30)
        return code, output.getvalue()

    def test_reads_element_pin_and_reports_new_stable_patch(self):
        self.assertEqual("10.0.14", checker.read_pin(self.project))
        code, output = self.run_checker(metadata())
        self.assertEqual(1, code)
        self.assertIn("10.0.14 | 10.0.15 | yes", output)
        self.assertNotIn("preview", output)
        self.assertNotIn("11.0.99", output)

    def test_reads_pin_conditioned_on_self_contained_publish(self):
        self.project.write_text("<Project><PropertyGroup><RuntimeFrameworkVersion Condition=\"'$(SelfContained)' == 'true'\">10.0.14</RuntimeFrameworkVersion></PropertyGroup></Project>", encoding="utf-8")
        self.assertEqual("10.0.14", checker.read_pin(self.project))
        code, output = self.run_checker(metadata())
        self.assertEqual(1, code)
        self.assertIn("10.0.14 | 10.0.15 | yes", output)

    def test_up_to_date_pin_succeeds_with_numeric_patch_comparison(self):
        code, output = self.run_checker(metadata("10.0.14"))
        self.assertEqual(0, code)
        self.assertIn("No newer stable patch", output)

    def test_missing_duplicate_or_invalid_pin_fails_before_network_access(self):
        for text in ('<Project />', '<Project><RuntimeFrameworkVersion>10.0.*</RuntimeFrameworkVersion></Project>',
                     '<Project><RuntimeFrameworkVersion>10.0.14</RuntimeFrameworkVersion><RuntimeFrameworkVersion>10.0.15</RuntimeFrameworkVersion></Project>'):
            with self.subTest(text=text):
                self.project.write_text(text, encoding="utf-8")
                with patch.object(checker, "urlopen") as request, patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": ""}), patch("sys.stdout", new_callable=io.StringIO):
                    self.assertEqual(2, checker.main(["--project", str(self.project)]))
                request.assert_not_called()

    def test_wrong_channel_or_missing_runtime_is_not_an_up_to_date_result(self):
        for response in ({"channel-version": "11.0", "releases": []}, {"channel-version": "10.0", "releases": [{}]}):
            with self.subTest(response=response):
                code, output = self.run_checker(response)
                self.assertEqual(2, code)
                self.assertIn("check error", output)

    def test_network_errors_are_distinct_from_updates(self):
        for error in (OSError("offline"), IncompleteRead(b"partial")):
            with self.subTest(error=type(error).__name__), patch.object(checker, "urlopen", side_effect=error), \
                    patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": ""}), patch("sys.stdout", new_callable=io.StringIO) as output:
                self.assertEqual(2, checker.main(["--project", str(self.project)]))
            self.assertIn("check error", output.getvalue())

    def test_workflow_summary_contains_the_update_result(self):
        summary = Path(self.temp.name) / "summary.md"
        with patch.object(checker, "urlopen", return_value=io.BytesIO(json.dumps(metadata()).encode())), \
                patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(summary)}), patch("sys.stdout", new_callable=io.StringIO):
            self.assertEqual(1, checker.main(["--project", str(self.project)]))
        self.assertIn("10.0.14 | 10.0.15 | yes", summary.read_text(encoding="utf-8"))
