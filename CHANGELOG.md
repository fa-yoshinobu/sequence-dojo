# Changelog

## [Unreleased]

### Changed

- Aligned local and CI release output at `artifacts/release/`, with a fixed-name distribution ZIP and UTF-8/LF SHA-256 checksum.
- Standardized English release notes and VirusTotal workflows; preserve published assets and scan all published executables.

### Fixed

- Reject incomplete VirusTotal responses without a matching API-provided executable SHA-256.

- Wait for the submitted VirusTotal analysis, verify published executable hashes and preserve unrelated release notes during rescans.
