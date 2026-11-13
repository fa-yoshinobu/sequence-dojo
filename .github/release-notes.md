## Download
- [Windows x64 ZIP]({{DOWNLOAD_URL}})
- [SHA-256 checksum]({{CHECKSUM_URL}})

## Getting started
Extract the ZIP file, then run `SequenceDojo.exe`.

Requirements: Windows 10 or later (x64) and Microsoft Edge WebView2 Runtime. The .NET runtime is included.

## Verification prerelease
This prerelease validates the improvement branch. It is not the stable release and is not merged into main.

## Changes
- Protect PLC WebSocket access with a per-launch session and exact origin checks.
- Clear PLC inputs on disconnect and recover protocol connections after errors.
- Serve embedded web assets from a single executable.
- Hand project files to the running instance and keep bounded local diagnostics.
- Keep task timing consistent while minimized and support importing custom tasks.
- Add application tests, browser policy checks and release/runtime validation.

<!-- virustotal:start -->
{{VIRUSTOTAL_CONTENT}}
<!-- virustotal:end -->
