# Changelog

## [Unreleased]

## [0.3.1] - 2026-11-13

### Fixed

- Show the PLC front close-up automatically when a model is selected.
- Move the 3D model caption above the PLC, away from the wiring. Remove the redundant change caption and switch models without a wire-removal confirmation.
- Focus the PLC candidate list when it opens and keep panel keyboard input from moving the 3D camera.
- Use an in-page PLC model list that commits on a model click or Enter, without a separate apply button, native dropdown popup or window-focus switching. When closed, Up/Down switches the model and 3D view immediately; when open, arrows move the candidate selection.
- Align PLC wire connection heights with the practice-board terminals and adjust the support height for each PLC body.

## [0.3.0] - 2026-11-13

### Added

- Add 18 Mitsubishi wiring configurations across FX5S, FX5U, MELSEC-Q and iQ-R: AC100V-compatible power, 16 DC24V inputs, and 14–16 relay or NPN sink outputs, with matching screw or push-in terminal blocks.
- Add series, output and terminal filters, a PLC front close-up, terminal/common tooltips and model-selection diagnostics.
- Import terminal definitions from qet-io-builder and document the manufacturer references.

### Changed

- Refine PLC covers, terminal blocks, CPU ports and power-unit colors using manufacturer photos and drawings; show model numbers without logos.
- Preview disconnected wires before changing PLC models and preserve the current project when an unsupported saved model is opened.
- Support importing, validating and saving custom practice tasks.

- Monitor the pinned bundled runtime weekly against official stable releases without updating published assets.

- Migrate the application and build workflow to .NET 10 and update the bundled Three.js renderer to r187.

- Aligned local and CI release output at `artifacts/release/`, with a fixed-name distribution ZIP and UTF-8/LF SHA-256 checksum.
- Standardized English release notes and VirusTotal workflows; preserve published assets and scan all published executables.

### Fixed

- Recover pointer capture after interrupted canvas gestures and restore the previous model and wires if model switching fails.
- Keep simulation and task timing consistent while minimized, and harden browser policy configuration and fallback-port handling.
- Verify the published executable version before packaging and confirm a release-body update after an ambiguous API error.
- Explain when changed release assets require a new VirusTotal scan.

- Align SDK requirements, the build error URL, third-party copyright notices and the development asset path with the current application.

- Reject incomplete VirusTotal responses without a matching API-provided executable SHA-256.

- Wait for the submitted VirusTotal analysis, verify published executable hashes and preserve unrelated release notes during rescans.
