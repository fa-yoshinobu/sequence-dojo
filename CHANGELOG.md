# Changelog

## [Unreleased]

### Changed

- Monitor the pinned bundled runtime weekly against official stable releases without updating published assets.

- Migrate the application and build workflow to .NET 10 and update the bundled Three.js renderer to r187.

- Aligned local and CI release output at `artifacts/release/`, with a fixed-name distribution ZIP and UTF-8/LF SHA-256 checksum.
- Standardized English release notes and VirusTotal workflows; preserve published assets and scan all published executables.

### Fixed

- Verify the published executable version before packaging and confirm a release-body update after an ambiguous API error.
- Explain when changed release assets require a new VirusTotal scan.

- Align SDK requirements, the build error URL, third-party copyright notices and the development asset path with the current application.

- Reject incomplete VirusTotal responses without a matching API-provided executable SHA-256.

- Wait for the submitted VirusTotal analysis, verify published executable hashes and preserve unrelated release notes during rescans.
