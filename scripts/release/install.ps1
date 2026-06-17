# Eshyra CLI installer -- Windows (PowerShell)
#
# Usage:
#   irm https://github.com/jbongaarts/eshyra/releases/latest/download/install.ps1 | iex
#
# Parameters:
#   -Version <tag>      install a specific release tag, e.g. v0.1.0
#                       defaults to the latest GitHub Release
#                       also read from $env:ESHYRA_VERSION
#   -BaseUrl <url>      override the base download URL (for local testing)
#                       also read from $env:ESHYRA_BASE_URL
#   -GithubRepo <slug>  GitHub repo slug (default: jbongaarts/eshyra)
#
# What this script does:
#   1. Detects Windows x64 (AMD64) architecture.
#   2. Resolves the release version (GitHub API or -Version/-$env:ESHYRA_VERSION).
#   3. Downloads the matching self-contained ZIP archive.
#   4. Verifies the SHA-256 checksum when sha256sums.txt is available.
#   5. Installs to $env:LOCALAPPDATA\Eshyra\app\<target>\
#   6. Creates $env:LOCALAPPDATA\Eshyra\bin\eshyra.cmd pointing to the installed launcher.
#   7. Adds $env:LOCALAPPDATA\Eshyra\bin to your user PATH if not already present.
#   8. Updates the current PowerShell session PATH so eshyra is immediately usable.
#   9. Verifies the installed command runs.
#
# This script does NOT require Node.js, npm, or any system package manager.
# Dolt (for campaign checkpoints) is NOT installed here -- it is self-provisioning.

[CmdletBinding()]
param(
    [string]$Version = $env:ESHYRA_VERSION,
    [string]$BaseUrl = $env:ESHYRA_BASE_URL,
    [string]$GithubRepo = 'jbongaarts/eshyra'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------- helpers -----------------------------------------------------------

function Write-Step([string]$Msg) {
    Write-Host "`n==> $Msg" -ForegroundColor Cyan
}

function Write-Log([string]$Msg) {
    Write-Host "  $Msg"
}

# ---------- platform detection ------------------------------------------------

function Get-EshyraPlatform {
    # PROCESSOR_ARCHITECTURE is 'x86' in 32-bit PowerShell on 64-bit Windows;
    # PROCESSOR_ARCHITEW6432 then holds the true 64-bit architecture.
    $arch = $env:PROCESSOR_ARCHITECTURE
    if ($arch -eq 'x86' -and $env:PROCESSOR_ARCHITEW6432 -eq 'AMD64') {
        $arch = 'AMD64'
    }
    if ($arch -ne 'AMD64') {
        throw "Unsupported Windows architecture: $arch. Only x64 (AMD64) is supported."
    }
    return 'windows-x64'
}

# ---------- version resolution ------------------------------------------------

function Resolve-EshyraVersion([string]$Repo) {
    if ($Version -and $Version -ne '') {
        return $Version.TrimStart('v')
    }
    $apiUrl = "https://api.github.com/repos/$Repo/releases/latest"
    try {
        $response = Invoke-RestMethod -Uri $apiUrl -UseBasicParsing -ErrorAction Stop
        $tag = $response.tag_name
        if (-not $tag) { throw "GitHub API response did not include tag_name" }
        return $tag.TrimStart('v')
    }
    catch {
        throw "Could not determine latest release version from the GitHub API: $_ `nSet -Version or ESHYRA_VERSION to install a specific tag."
    }
}

# ---------- checksum verification ---------------------------------------------

function Confirm-EshyraChecksum([string]$ArchivePath, [string]$ChecksumsPath) {
    $archiveName = [System.IO.Path]::GetFileName($ArchivePath)
    $expected = $null
    foreach ($line in [System.IO.File]::ReadLines($ChecksumsPath)) {
        # sha256sums.txt format: "<hash>  <filename>" (two spaces)
        $parts = $line -split '\s+', 2
        if ($parts.Count -eq 2 -and $parts[1].Trim() -eq $archiveName) {
            $expected = $parts[0].Trim().ToLower()
            break
        }
    }
    if (-not $expected) {
        Write-Warning "No checksum entry for $archiveName in sha256sums.txt; skipping verification"
        return
    }
    $actual = (Get-FileHash -Path $ArchivePath -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $expected) {
        throw "SHA-256 checksum mismatch for ${archiveName}:`n  expected: $expected`n  got:      $actual`n`nThe download may be corrupt or tampered. Please retry."
    }
    Write-Log "SHA-256 verified"
}

# ---------- main --------------------------------------------------------------

function Install-Eshyra {
    Write-Step "Detecting platform"
    $target = Get-EshyraPlatform
    Write-Log "platform: $target"

    Write-Step "Resolving version"
    $version = Resolve-EshyraVersion $GithubRepo
    $tag = "v$version"
    Write-Log "version: $version (tag: $tag)"

    $archiveName = "eshyra-$version-$target.zip"
    if (-not $BaseUrl -or $BaseUrl -eq '') {
        $BaseUrl = "https://github.com/$GithubRepo/releases/download/$tag"
    }
    $archiveUrl = "$BaseUrl/$archiveName"
    $checksumsUrl = "$BaseUrl/sha256sums.txt"

    Write-Step "Downloading Eshyra $version for $target"
    Write-Log "from: $archiveUrl"

    $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "eshyra-install-$([System.IO.Path]::GetRandomFileName())"
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

    try {
        $archivePath = Join-Path $tmpDir $archiveName
        Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath -UseBasicParsing -ErrorAction Stop

        Write-Step "Verifying checksum"
        $checksumsPath = Join-Path $tmpDir 'sha256sums.txt'
        try {
            Invoke-WebRequest -Uri $checksumsUrl -OutFile $checksumsPath -UseBasicParsing -ErrorAction Stop
            Confirm-EshyraChecksum $archivePath $checksumsPath
        }
        catch {
            if ($_.Exception.Message -match 'mismatch') { throw }
            Write-Warning "sha256sums.txt not available for this release; skipping checksum verification"
        }

        Write-Step "Installing"
        $installBase = Join-Path $env:LOCALAPPDATA 'Eshyra\app'
        $installDir = Join-Path $installBase "eshyra-$version-$target"

        if (Test-Path $installDir) {
            Remove-Item -Path $installDir -Recurse -Force
        }
        New-Item -ItemType Directory -Path $installBase -Force | Out-Null
        Expand-Archive -Path $archivePath -DestinationPath $installBase -Force
        Write-Log "installed: $installDir"

        Write-Step "Creating command"
        $binDir = Join-Path $env:LOCALAPPDATA 'Eshyra\bin'
        New-Item -ItemType Directory -Path $binDir -Force | Out-Null

        # Write a .cmd wrapper that delegates to the versioned launcher using
        # %LOCALAPPDATA% so the wrapper survives a user profile path change.
        $wrapperPath = Join-Path $binDir 'eshyra.cmd'
        $launcherRel = "eshyra-$version-$target\bin\eshyra.cmd"
        $wrapperContent = "@echo off`r`nCALL `"%LOCALAPPDATA%\Eshyra\app\$launcherRel`" %*`r`n"
        [System.IO.File]::WriteAllText($wrapperPath, $wrapperContent, [System.Text.Encoding]::ASCII)
        Write-Log "wrapper: $wrapperPath"

        # Add $binDir to the user PATH if not already present.
        $userPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
        if ($null -eq $userPath) { $userPath = '' }
        $pathDirs = $userPath -split ';' | Where-Object { $_ -ne '' }
        if ($pathDirs -notcontains $binDir) {
            $newPath = (($pathDirs + @($binDir)) -join ';').TrimStart(';')
            [System.Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
            Write-Log "added to user PATH: $binDir"
        }

        # Update the current session PATH so eshyra is immediately usable.
        if ($env:Path -notmatch [regex]::Escape($binDir)) {
            $env:Path = "$binDir;$($env:Path)"
        }

        Write-Step "Verifying install"
        # No-config run: should exit 1 and print setup guidance including ANTHROPIC_API_KEY.
        $out = ''
        try {
            $out = & $wrapperPath 2>&1 | Out-String
        }
        catch {
            # Native command failure is expected (exit code 1); capture any output.
            $out = $_.Exception.Message
        }
        if ($out -match 'ANTHROPIC_API_KEY') {
            Write-Log "Eshyra $version is ready"
        }
        else {
            Write-Warning "Verification did not match expected output; try: eshyra"
        }

        Write-Host "`nEshyra $version installed. Open a new terminal and run:`n" -ForegroundColor Green
        Write-Host "  eshyra"
        Write-Host "`nSet a provider key to start playing:`n"
        Write-Host '  $env:ANTHROPIC_API_KEY = "sk-ant-..."'
        Write-Host '  eshyra new "My Campaign"'
        Write-Host "  eshyra play`n"
    }
    finally {
        Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Install-Eshyra
