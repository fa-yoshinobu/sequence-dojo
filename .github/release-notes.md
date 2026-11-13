## Download
- [Windows x64 ZIP]({{DOWNLOAD_URL}})
- [SHA-256 checksum]({{CHECKSUM_URL}})

## Getting started
Extract the ZIP file, then run `SequenceDojo.exe`.

Requirements: Windows 10 or later (x64) and Microsoft Edge WebView2 Runtime. The .NET runtime is included.

## Changes
### Added
- 18 Mitsubishi wiring configurations across FX5S, FX5U, MELSEC-Q and iQ-R, with AC100V-compatible power, 16 DC24V inputs and 14–16 relay or NPN sink outputs. Input and output modules use matching screw or push-in terminal blocks.
- PLC filters by series, output and terminal type; front close-up; terminal/common tooltips; and model-selection diagnostics.
- Custom practice-task import, validation and persistence.

### Changed
- Refine PLC covers, terminal blocks, CPU ports and power-unit colors from manufacturer references, with model numbers and no logos.
- Show which wires will be removed before switching models. Reject unsupported saved models without changing the current project.
- Update to .NET 10 and Three.js r187.
- Use a fixed-name Windows ZIP and SHA-256 checksum with English release notes and scan results.
- Publish executables and distribution assets to `artifacts/release/` in local builds and CI.

### Fixed
- Recover model selection after interrupted canvas gestures and restore the previous model and wiring when switching fails.
- Keep simulation and task timing consistent while minimized, and harden browser policy configuration and fallback-port handling.
- Reject incomplete VirusTotal responses without a matching API-provided executable SHA-256.
- Wait for the submitted VirusTotal analysis, verify all published executable hashes and preserve unrelated release notes during rescans.

PLC geometry is an approximation for practice, not manufacturing CAD. This release excludes DC-powered CPU units, EC variants, connector-type I/O and mixed screw/push-in module pairs. Practice uses the first 16 inputs and 14 outputs.

<!-- virustotal:start -->
{{VIRUSTOTAL_CONTENT}}
<!-- virustotal:end -->
