"""Check the application's pinned bundled runtime against official stable patches."""

import argparse
from http.client import HTTPException
import json
import os
from pathlib import Path
import re
from urllib.request import urlopen
import xml.etree.ElementTree as ET


def version_tuple(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", value):
        raise ValueError("Runtime versions must use MAJOR.MINOR.PATCH.")
    return tuple(int(part) for part in value.split("."))


def read_pin(project):
    values = [item.text for item in ET.parse(project).getroot().iter("RuntimeFrameworkVersion")]
    if len(values) != 1:
        raise ValueError("Exactly one RuntimeFrameworkVersion property is required.")
    version = (values[0] or "").strip()
    version_tuple(version)
    return version


def compare_version(pinned, metadata):
    channel = ".".join(pinned.split(".")[:2])
    if metadata.get("channel-version") != channel:
        raise ValueError("Official runtime metadata does not match the pinned channel.")
    candidates = []
    for release in metadata["releases"]:
        version = release.get("runtime", {}).get("version")
        if isinstance(version, str) and re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
            if version_tuple(version)[:2] == version_tuple(pinned)[:2]:
                candidates.append((version_tuple(version), version))
    if not candidates:
        raise ValueError("No stable runtime version was found for the pinned channel.")
    latest = max(candidates)[1]
    return {"pinned": pinned, "latest": latest, "outdated": version_tuple(pinned) < version_tuple(latest)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, default=Path("src/SequenceDojo/SequenceDojo.csproj"))
    args = parser.parse_args(argv)
    try:
        pinned = read_pin(args.project)
        channel = ".".join(pinned.split(".")[:2])
        url = f"https://builds.dotnet.microsoft.com/dotnet/release-metadata/{channel}/releases.json"
        with urlopen(url, timeout=30) as response:
            result = compare_version(pinned, json.load(response))
        lines = ["## Bundled runtime update check", "", f"Official metadata: {url}", "",
                 "| Project pin | Latest stable | Update available |", "| --- | --- | --- |",
                 f"| {result['pinned']} | {result['latest']} | {'yes' if result['outdated'] else 'no'} |", "",
                 "A newer runtime patch is available. Review the pin, then validate a new application release."
                 if result["outdated"] else "No newer stable patch is available for the pinned channel."]
        code = 1 if result["outdated"] else 0
    except (OSError, HTTPException, ValueError, TypeError, KeyError, AttributeError, ET.ParseError):
        lines = ["## Bundled runtime update check", "", "Unable to read the runtime pin or official release metadata. This is a check error, not an update result."]
        code = 2
    report = "\n".join(lines) + "\n"
    print(report, end="")
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(summary).open("a", encoding="utf-8") as stream:
            stream.write(report)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
