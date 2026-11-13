## Download
- [Windows x64 ZIP]({{DOWNLOAD_URL}})
- [SHA-256 checksum]({{CHECKSUM_URL}})

## Getting started
Extract the ZIP file, then run `SequenceDojo.exe`.

Requirements: Windows 10 or later (x64) and Microsoft Edge WebView2 Runtime. The .NET runtime is included.

## Changes
### Changed
- Switch the PLC model and 3D view immediately with Up/Down while the closed model field has focus. In the open list, use arrows to move between candidates and click or press Enter to confirm.
- Move automatically to the PLC front close-up after selecting a model.
- Remove the redundant change caption and wire-removal confirmation. Wires to terminals missing from the new model are disconnected automatically; compatible wires remain connected.

### Fixed
- Replace the native dropdown with an in-page list so selecting models no longer requires switching window focus.
- Focus the list when it opens and prevent panel keyboard input from moving the 3D camera or scrolling the closed model field.
- Align PLC wire connection heights with the practice-board terminals and adjust the support height for each model.
- Move the model caption above the PLC to keep it readable with wiring connected.

PLC geometry is an approximation for practice, not manufacturing CAD. This release excludes DC-powered CPU units, EC variants, connector-type I/O and mixed screw/push-in module pairs. Practice uses the first 16 inputs and 14 outputs.

<!-- virustotal:start -->
{{VIRUSTOTAL_CONTENT}}
<!-- virustotal:end -->
