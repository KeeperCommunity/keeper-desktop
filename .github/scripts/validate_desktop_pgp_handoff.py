"""Read-only validation for an explicitly approved Desktop PGP handoff.

This does not download, sign, upload, publish, or infer human approval.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

REPOSITORY = "KeeperCommunity/keeper-desktop"
REPOSITORY_ID = 846051536


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate(raw_manifest, manifest_digest, release, run, jobs):
    require(re.fullmatch(r"[0-9a-f]{64}", manifest_digest or ""), "Expected manifest SHA-256 required")
    require(hashlib.sha256(raw_manifest.encode("utf-8")).hexdigest() == manifest_digest, "Approved manifest bytes differ")
    manifest = json.loads(raw_manifest)
    require(set(manifest) == {"release_id", "tag", "source_sha", "build_run_id", "assets"}, "Unexpected manifest fields")
    sha = manifest["source_sha"]
    tag = manifest["tag"]
    require(re.fullmatch(r"[0-9a-f]{40}", sha or ""), "Full approved source SHA required")
    require(re.fullmatch(r"keeper-desktop-v[0-9]+\.[0-9]+\.[0-9]+", tag or ""), "Production Desktop tag required; QA/dev tags refused")
    require(type(manifest["release_id"]) is int and manifest["release_id"] > 0, "Explicit release ID required")
    require(type(manifest["build_run_id"]) is int and manifest["build_run_id"] > 0, "Explicit build run ID required")
    require(release.get("id") == manifest["release_id"], "Release ID mismatch")
    require(release.get("tag_name") == tag, "Release tag mismatch")
    require(release.get("target_commitish") == sha, "Draft target must be the exact approved source SHA")
    require(release.get("draft") is True and release.get("prerelease") is False, "Only a production draft is eligible")
    require(run.get("id") == manifest["build_run_id"] and run.get("head_sha") == sha, "Build source/run mismatch")
    require(run.get("repository", {}).get("id") == REPOSITORY_ID and
            run.get("repository", {}).get("full_name") == REPOSITORY, "Wrong build repository")
    require(run.get("path") == ".github/workflows/release.yml", "Wrong build workflow")
    require(run.get("event") in {"push", "workflow_dispatch"} and run.get("head_branch") == "release", "Unapproved build route")
    require(run.get("status") == "completed" and run.get("conclusion") == "success", "Production build not successful")
    job_list = jobs.get("jobs", [])
    require(jobs.get("total_count") == len(job_list), "Incomplete job metadata")
    require(not any(j.get("name") == "build-qa" and j.get("conclusion") != "skipped" for j in job_list), "QA runs cannot sign releases")
    production_jobs = [j for j in job_list if j.get("name", "").startswith("publish-tauri")]
    require(production_jobs and all(j.get("status") == "completed" and j.get("conclusion") == "success" for j in production_jobs), "Every production packaging job must succeed")
    expected = manifest["assets"]
    actual = release.get("assets", [])
    require(isinstance(expected, list) and bool(expected), "Complete nonempty approved asset manifest required")
    require(len(expected) == len(actual), "Missing or extra release assets")
    require(len({a.get("id") for a in expected}) == len(expected) and
            len({a.get("name") for a in expected}) == len(expected), "Duplicate asset IDs/names")
    require(len({a.get("id") for a in actual}) == len(actual) and
            len({a.get("name") for a in actual}) == len(actual), "Duplicate remote asset IDs/names")
    actual_by_id = {a.get("id"): a for a in actual}
    for asset in expected:
        require(set(asset) == {"id", "name", "size", "sha256"}, "Unexpected asset fields")
        name = asset["name"]
        require(isinstance(name, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.+ -]*", name), "Unsafe asset filename")
        require(name not in {"SHA256SUMS.txt", "SHA256SUMS.txt.asc"}, "Existing checksum/signature output refused; no clobber")
        require(type(asset["id"]) is int and asset["id"] > 0 and type(asset["size"]) is int and asset["size"] > 0, "Invalid asset ID/size")
        require(re.fullmatch(r"[0-9a-f]{64}", asset["sha256"] or ""), "Approved asset SHA-256 required")
        remote = actual_by_id.get(asset["id"], {})
        require(remote.get("name") == name and remote.get("size") == asset["size"] and remote.get("state") == "uploaded", "Asset identity mismatch")
        require(remote.get("digest") == "sha256:" + asset["sha256"], "Remote asset digest absent or mismatched")
    return {
        "state": "PREFLIGHT_ONLY",
        "release_id": manifest["release_id"], "tag": tag, "source_sha": sha,
        "build_run_id": manifest["build_run_id"], "approved_manifest_sha256": manifest_digest,
        "assets": expected,
        "signing": "NOT RUN", "upload": "NOT RUN", "publication": "NOT RUN",
        "next_gate": "Independent review and specific signing/upload authorization; re-read release/run/assets and verify downloaded bytes before signing."
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--manifest-sha256", required=True)
    parser.add_argument("--release", required=True)
    parser.add_argument("--run", required=True)
    parser.add_argument("--jobs", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    result = validate(Path(args.manifest).read_text(), args.manifest_sha256,
                      json.loads(Path(args.release).read_text()),
                      json.loads(Path(args.run).read_text()),
                      json.loads(Path(args.jobs).read_text()))
    Path(args.output).write_text(json.dumps(result, indent=2) + "\n")
    print("Read-only Desktop handoff preflight PASS; signing/upload/publication NOT RUN")


if __name__ == "__main__":
    main()

