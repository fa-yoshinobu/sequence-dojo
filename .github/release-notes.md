## Download
- [Windows x64 ZIP]({{DOWNLOAD_URL}})
- [SHA-256 checksum]({{CHECKSUM_URL}})

## Getting started
Extract the ZIP file, then run `SequenceDojo.exe`.

Requirements: Windows 10 or later (x64) and Microsoft Edge WebView2 Runtime. The .NET runtime is included.

## Changes
### Changed
- Use a fixed-name Windows ZIP and SHA-256 checksum with English release notes and scan results.
- Publish executables and distribution assets to `artifacts/release/` in local builds and CI.

### Fixed
- Reject incomplete VirusTotal responses without a matching API-provided executable SHA-256.
- Wait for the submitted VirusTotal analysis, verify all published executable hashes and preserve unrelated release notes during rescans.

<!-- virustotal:start -->
{{VIRUSTOTAL_CONTENT}}
<!-- virustotal:end -->
