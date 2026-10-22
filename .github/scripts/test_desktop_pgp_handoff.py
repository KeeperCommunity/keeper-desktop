import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("guard", Path(__file__).with_name("validate_desktop_pgp_handoff.py"))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.sha = "a" * 40
        self.digest = "b" * 64
        self.manifest = {"release_id": 123, "tag": "keeper-desktop-v0.2.6", "source_sha": self.sha,
                         "build_run_id": 456, "assets": [{"id": 789, "name": "Keeper.Desktop_0.2.6_aarch64.dmg", "size": 42, "sha256": self.digest}]}
        self.release = {"id": 123, "tag_name": "keeper-desktop-v0.2.6", "target_commitish": self.sha, "draft": True, "prerelease": False,
                        "assets": [{"id": 789, "name": "Keeper.Desktop_0.2.6_aarch64.dmg", "size": 42, "state": "uploaded", "digest": "sha256:" + self.digest}]}
        self.run = {"id": 456, "head_sha": self.sha, "repository": {"id": 846051536, "full_name": guard.REPOSITORY},
                    "path": ".github/workflows/release.yml", "event": "push", "head_branch": "release", "status": "completed", "conclusion": "success"}
        self.jobs = {"total_count": 2, "jobs": [{"name": "build-qa", "status": "completed", "conclusion": "skipped"},
                                               {"name": "publish-tauri (macos-latest)", "status": "completed", "conclusion": "success"}]}

    def invoke(self, manifest=None, release=None, run=None, jobs=None, digest=None):
        raw = json.dumps(self.manifest if manifest is None else manifest)
        return guard.validate(raw, hashlib.sha256(raw.encode()).hexdigest() if digest is None else digest,
                              self.release if release is None else release, self.run if run is None else run,
                              self.jobs if jobs is None else jobs)

    def test_explicit_production_handoff_is_only_preflight(self):
        result = self.invoke()
        self.assertEqual(result["state"], "PREFLIGHT_ONLY")
        self.assertEqual([result[x] for x in ("signing", "upload", "publication")], ["NOT RUN"] * 3)

    def test_qa_run_even_on_release_branch_is_refused(self):
        self.jobs["jobs"][0]["conclusion"] = "success"
        self.jobs["jobs"][1]["conclusion"] = "skipped"
        with self.assertRaisesRegex(ValueError, "QA runs"):
            self.invoke()

    def test_dev_and_qa_tags_are_refused(self):
        for suffix in ("-qa.1", "-dev"):
            with self.subTest(suffix=suffix):
                value = copy.deepcopy(self.manifest)
                value["tag"] += suffix
                with self.assertRaisesRegex(ValueError, "Production Desktop tag"):
                    self.invoke(manifest=value)

    def test_manifest_byte_tampering_is_refused(self):
        with self.assertRaisesRegex(ValueError, "manifest bytes"):
            self.invoke(digest="0" * 64)

    def test_wrong_release_or_tag_or_source_is_refused(self):
        for key, value in (("id", 124), ("tag_name", "keeper-desktop-v0.2.5"), ("target_commitish", "release")):
            with self.subTest(key=key):
                release = copy.deepcopy(self.release)
                release[key] = value
                with self.assertRaises(ValueError):
                    self.invoke(release=release)

    def test_published_or_prerelease_is_refused(self):
        for key, value in (("draft", False), ("prerelease", True)):
            release = copy.deepcopy(self.release)
            release[key] = value
            with self.assertRaisesRegex(ValueError, "production draft"):
                self.invoke(release=release)

    def test_untrusted_wrong_source_or_failed_build_is_refused(self):
        for key, value in (("head_sha", "c"*40), ("path", ".github/workflows/dev-release.yml"), ("head_branch", "main"),
                           ("event", "pull_request"), ("conclusion", "failure")):
            with self.subTest(key=key):
                run = copy.deepcopy(self.run)
                run[key] = value
                with self.assertRaises(ValueError):
                    self.invoke(run=run)
        self.run["repository"]["id"] = 1
        with self.assertRaisesRegex(ValueError, "repository"):
            self.invoke()

    def test_failed_skipped_or_missing_production_packaging_is_refused(self):
        for result in ("failure", "skipped", None):
            jobs = copy.deepcopy(self.jobs)
            jobs["jobs"][1]["conclusion"] = result
            with self.assertRaisesRegex(ValueError, "production packaging"):
                self.invoke(jobs=jobs)

    def test_incomplete_job_page_is_refused(self):
        self.jobs["total_count"] = 101
        with self.assertRaisesRegex(ValueError, "Incomplete job"):
            self.invoke()

    def test_extra_missing_and_duplicate_assets_are_refused(self):
        for assets in ([], self.release["assets"] * 2):
            release = copy.deepcopy(self.release)
            release["assets"] = assets
            with self.assertRaises(ValueError):
                self.invoke(release=release)

    def test_asset_id_name_size_digest_and_upload_state_are_bound(self):
        for key, value in (("id", 790), ("name", "Other.dmg"), ("size", 43), ("digest", None), ("state", "new")):
            with self.subTest(key=key):
                release = copy.deepcopy(self.release)
                release["assets"][0][key] = value
                with self.assertRaises(ValueError):
                    self.invoke(release=release)

    def test_existing_outputs_and_path_names_are_refused(self):
        for name in ("SHA256SUMS.txt", "SHA256SUMS.txt.asc", "../payload", "-option"):
            manifest = copy.deepcopy(self.manifest)
            manifest["assets"][0]["name"] = name
            with self.assertRaises(ValueError):
                self.invoke(manifest=manifest)


if __name__ == "__main__":
    unittest.main()

