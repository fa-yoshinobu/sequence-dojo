[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')]
    [string]$Repository,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$')]
    [string]$ReleaseTag,

    [string]$VirusTotalContent = "## Security scan`nVirusTotal scan pending.",

    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$templatePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'release-notes.md'
$template = Get-Content -LiteralPath $templatePath -Raw -Encoding UTF8
$downloadUrl = "https://github.com/$Repository/releases/download/$ReleaseTag/SequenceDojo-win-x64.zip"
$notes = $template.Replace('{{DOWNLOAD_URL}}', $downloadUrl).Replace('{{CHECKSUM_URL}}', $downloadUrl + '.sha256').Replace('{{VIRUSTOTAL_CONTENT}}', $VirusTotalContent)
if ($notes -match '[\u3040-\u30ff\u3400-\u9fff]') { throw 'Release notes and scan results must be in English.' }
$notes = $notes.Replace("`r`n", "`n")
$destination = [System.IO.Path]::GetFullPath($OutputPath)
[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($destination)) | Out-Null
[System.IO.File]::WriteAllText($destination, $notes, [System.Text.UTF8Encoding]::new($false))
