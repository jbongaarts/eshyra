# Eshyra CLI installer -- Windows (PowerShell)
#
# Usage:
#   irm https://github.com/jbongaarts/eshyra/releases/latest/download/install.ps1 | iex
#
# To install a specific version, set ESHYRA_VERSION before piping:
#   $env:ESHYRA_VERSION = 'v0.1.0'
#   irm https://github.com/jbongaarts/eshyra/releases/latest/download/install.ps1 | iex
#
# Editions (ADR 0011) -- pick which gameplay provider binaries are bundled:
#   api    -- lean: api-native SDKs only, no bundled agent CLI binary (smallest)
#   claude -- Claude Agent SDK (Claude Code CLI) bundled   [DEFAULT]
#   codex  -- Codex SDK (@openai/codex CLI) bundled
#   full   -- both agent binaries bundled
# Select with -Edition <name> (direct invocation) or $env:ESHYRA_EDITION (works
# under `irm ... | iex` too). With an interactive console and no selection, the
# installer prompts (default: claude).
#   $env:ESHYRA_EDITION = 'codex'
#   irm https://github.com/jbongaarts/eshyra/releases/latest/download/install.ps1 | iex
#
# Parameters (when running the script directly, not via iex):
#   -Version <tag>      install a specific release tag, e.g. v0.1.0
#                       also read from $env:ESHYRA_VERSION
#   -Edition <name>     edition to install (api|claude|codex|full)
#                       also read from $env:ESHYRA_EDITION; defaults to claude
#   -BaseUrl <url>      override the base download URL (for local testing)
#                       also read from $env:ESHYRA_BASE_URL
#   -GithubRepo <slug>  GitHub repo slug (default: jbongaarts/eshyra)
#
# What this script does:
#   1. Detects Windows x64 (AMD64) architecture.
#   2. Queries the GitHub Releases API to find the actual archive asset URL
#      (asset discovery -- does not assume the archive name matches the tag name,
#      since the package version embedded in the artifact may differ).
#   3. Downloads the archive and verifies its SHA-256 checksum.
#   4. Installs to $env:LOCALAPPDATA\Eshyra\app\<artifact-name>\
#   5. Creates $env:LOCALAPPDATA\Eshyra\bin\eshyra.cmd pointing to the installed launcher.
#   6. Adds $env:LOCALAPPDATA\Eshyra\bin to your user PATH if not already present.
#   7. Updates the current PowerShell session PATH so eshyra is immediately usable.
#   8. Verifies the installed command runs.
#
# This script does NOT require Node.js, npm, or any system package manager.
# Dolt (for campaign checkpoints) is NOT installed here -- it is self-provisioning.

[CmdletBinding()]
param(
    [string]$Version = $env:ESHYRA_VERSION,
    [string]$Edition = $env:ESHYRA_EDITION,
    [string]$BaseUrl = $env:ESHYRA_BASE_URL,
    [string]$GithubRepo = 'jbongaarts/eshyra',
    # Test/development support only (NOT a normal user install path):
    #   -InstallRoot  / $env:ESHYRA_INSTALL_ROOT -- base dir for the app tree
    #   -BinDir       / $env:ESHYRA_BIN_DIR      -- dir for the eshyra.cmd wrapper
    #   -SkipChecksum / $env:ESHYRA_SKIP_CHECKSUM=1 -- skip verification (dev loops)
    # When -InstallRoot or -BinDir is set the installer runs in test mode and
    # does NOT modify the persistent user PATH.
    [string]$InstallRoot = $env:ESHYRA_INSTALL_ROOT,
    [string]$BinDir = $env:ESHYRA_BIN_DIR,
    [switch]$SkipChecksum = ($env:ESHYRA_SKIP_CHECKSUM -eq '1')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Single named default edition (ADR 0011). Keep in lockstep with editions.mjs
# DEFAULT_EDITION; releaseInstallerPolicy.test.ts guards that they match.
$EshyraDefaultEdition = 'claude'

# ---------- helpers -----------------------------------------------------------

function Write-Step([string]$Msg) {
    Write-Host "`n==> $Msg" -ForegroundColor Cyan
}

function Write-Log([string]$Msg) {
    Write-Host "  $Msg"
}

# ---------- edition selection -------------------------------------------------

function Resolve-EshyraEdition([string]$Requested) {
    # Precedence: -Edition / $env:ESHYRA_EDITION, then interactive prompt (when a
    # console is attached), then the single default edition.
    $value = $Requested
    if (-not $value -or $value -eq '') {
        if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
            Write-Host "`nSelect an Eshyra edition (gameplay provider binaries to bundle):"
            Write-Host '  api    - lean, no agent CLI binary (smallest)'
            Write-Host '  claude - Claude Agent SDK [default]'
            Write-Host '  codex  - Codex CLI'
            Write-Host '  full   - both agent binaries'
            $choice = Read-Host "edition [$EshyraDefaultEdition]"
            $value = if ($choice -and $choice -ne '') { $choice } else { $EshyraDefaultEdition }
        }
        else {
            $value = $EshyraDefaultEdition
        }
    }
    if ($value -notin @('api', 'claude', 'codex', 'full')) {
        throw "Unknown edition: `"$value`" (supported: api, claude, codex, full)"
    }
    return $value
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

# ---------- release asset resolution -----------------------------------------

function Resolve-EshyraRelease([string]$Repo, [string]$Target, [string]$Edition) {
    if ($BaseUrl -and $BaseUrl -ne '') {
        # Custom base URL mode (local testing or staging).
        # Derive the archive name from Edition + Version + Target. Version
        # defaults to 0.0.0-dev to match the builder's sentinel fallback when no
        # release version is injected (untagged dev/local builds).
        $ver = if ($Version -and $Version -ne '') { $Version.TrimStart('v') } else { '0.0.0-dev' }
        $archiveName = "eshyra-$Edition-$ver-$Target.zip"
        return @{
            ArchiveUrl   = "$BaseUrl/$archiveName"
            ChecksumsUrl = "$BaseUrl/sha256sums.txt"
            ArchiveName  = $archiveName
        }
    }

    # GitHub Releases mode.
    # Query the API to find the actual archive asset URL by edition prefix +
    # target suffix. This intentionally avoids constructing the filename from the
    # tag name: the released artifact is named by the builder's resolved version,
    # which is the tag with its leading "v" stripped
    # (e.g. tag v0.1.0 -> eshyra-claude-0.1.0-…). Matching prefix+suffix is robust
    # to that normalization and uniquely identifies the edition x target asset.
    $apiUrl = if ($Version -and $Version -ne '') {
        $tag = "v$($Version.TrimStart('v'))"
        "https://api.github.com/repos/$Repo/releases/tags/$tag"
    }
    else {
        "https://api.github.com/repos/$Repo/releases/latest"
    }

    Write-Log "querying: $apiUrl"
    try {
        $release = Invoke-RestMethod -Uri $apiUrl -UseBasicParsing -ErrorAction Stop
    }
    catch {
        throw "Failed to fetch release info from GitHub API ($apiUrl): $_"
    }

    # Find the Windows x64 archive asset for this edition by name prefix+suffix.
    $asset = $release.assets | Where-Object { $_.name -like "eshyra-$Edition-*-$Target.zip" } | Select-Object -First 1
    if (-not $asset) {
        throw "No $Edition $Target archive found in release $($release.tag_name) assets. The release may not have all artifacts/editions yet."
    }

    # Find sha256sums.txt in the assets list; fall back to a sibling URL.
    $checksumsAsset = $release.assets | Where-Object { $_.name -eq 'sha256sums.txt' } | Select-Object -First 1
    $checksumsUrl = if ($checksumsAsset) {
        $checksumsAsset.browser_download_url
    }
    else {
        $base = $asset.browser_download_url.Substring(0, $asset.browser_download_url.LastIndexOf('/'))
        "$base/sha256sums.txt"
    }

    return @{
        ArchiveUrl   = $asset.browser_download_url
        ChecksumsUrl = $checksumsUrl
        ArchiveName  = $asset.name
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
        # Fail closed: the release publishes a checksum file but it has no entry
        # for the archive we are about to install, so we cannot verify it.
        throw "No checksum entry for $archiveName in sha256sums.txt. The release publishes checksums but none matches the archive being installed; refusing to install an unverifiable download (it may be corrupt or tampered)."
    }
    $actual = (Get-FileHash -Path $ArchivePath -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $expected) {
        throw "SHA-256 checksum mismatch for ${archiveName}:`n  expected: $expected`n  got:      $actual`n`nThe download may be corrupt or tampered. Please retry."
    }
    Write-Log "SHA-256 verified"
}

# ---------- main --------------------------------------------------------------

function Install-Eshyra {
    Write-Step "Selecting edition"
    $resolvedEdition = Resolve-EshyraEdition $Edition
    Write-Log "edition: $resolvedEdition"

    Write-Step "Detecting platform"
    $target = Get-EshyraPlatform
    Write-Log "platform: $target"

    Write-Step "Resolving release"
    $release = Resolve-EshyraRelease $GithubRepo $target $resolvedEdition
    Write-Log "archive: $($release.ArchiveName)"
    Write-Log "from:    $($release.ArchiveUrl)"

    $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "eshyra-install-$([System.IO.Path]::GetRandomFileName())"
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

    try {
        $archivePath = Join-Path $tmpDir $release.ArchiveName
        Invoke-WebRequest -Uri $release.ArchiveUrl -OutFile $archivePath -UseBasicParsing -ErrorAction Stop

        Write-Step "Verifying checksum"
        if ($SkipChecksum) {
            Write-Warning "ESHYRA_SKIP_CHECKSUM=1 set; skipping checksum verification (test/dev only)"
        }
        else {
            $checksumsPath = Join-Path $tmpDir 'sha256sums.txt'
            $checksumsDownloaded = $false
            try {
                Invoke-WebRequest -Uri $release.ChecksumsUrl -OutFile $checksumsPath -UseBasicParsing -ErrorAction Stop
                $checksumsDownloaded = $true
            }
            catch {
                # No checksum file at all: this release predates published
                # checksums. We cannot verify, so warn loudly but proceed.
                Write-Warning "sha256sums.txt could not be downloaded; this release predates published checksums, so the download cannot be verified. Continuing without verification."
            }
            if ($checksumsDownloaded) {
                # Checksums published -> verification is mandatory. A missing
                # entry or a hash mismatch throws and aborts the install.
                Confirm-EshyraChecksum $archivePath $checksumsPath
            }
        }

        Write-Step "Installing"
        # Test mode (InstallRoot/BinDir overrides) keeps the install out of the
        # real %LOCALAPPDATA% and off the persistent user PATH.
        $testMode = [bool]$InstallRoot -or [bool]$BinDir
        $eshyraRoot = if ($InstallRoot) { $InstallRoot } else { $env:LOCALAPPDATA }
        $installBase = Join-Path $eshyraRoot 'Eshyra\app'
        # The artifact name (minus .zip) is the top-level directory inside the archive.
        $artifactDir = [System.IO.Path]::GetFileNameWithoutExtension($release.ArchiveName)
        $installDir = Join-Path $installBase $artifactDir

        if (Test-Path $installDir) {
            Remove-Item -Path $installDir -Recurse -Force
        }
        New-Item -ItemType Directory -Path $installBase -Force | Out-Null
        Expand-Archive -Path $archivePath -DestinationPath $installBase -Force
        Write-Log "installed: $installDir"

        Write-Step "Creating command"
        $binDir = if ($BinDir) { $BinDir } else { Join-Path $env:LOCALAPPDATA 'Eshyra\bin' }
        New-Item -ItemType Directory -Path $binDir -Force | Out-Null

        # Write a .cmd wrapper that delegates to the versioned launcher. For a
        # normal install we reference %LOCALAPPDATA% so the wrapper survives a
        # user profile path change; in test mode the install root is arbitrary,
        # so we point at the resolved absolute launcher path instead.
        $wrapperPath = Join-Path $binDir 'eshyra.cmd'
        $launcherTarget = if ($testMode) {
            Join-Path $installDir 'bin\eshyra.cmd'
        }
        else {
            "%LOCALAPPDATA%\Eshyra\app\$artifactDir\bin\eshyra.cmd"
        }
        $wrapperContent = "@echo off`r`nCALL `"$launcherTarget`" %*`r`n"
        [System.IO.File]::WriteAllText($wrapperPath, $wrapperContent, [System.Text.Encoding]::ASCII)
        Write-Log "wrapper: $wrapperPath"

        # Add $binDir to the user PATH if not already present. Skipped in test
        # mode so smoke tests never touch the developer's persistent PATH.
        if (-not $testMode) {
            $userPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
            if ($null -eq $userPath) { $userPath = '' }
            $pathDirs = $userPath -split ';' | Where-Object { $_ -ne '' }
            if ($pathDirs -notcontains $binDir) {
                $newPath = (($pathDirs + @($binDir)) -join ';').TrimStart(';')
                [System.Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
                Write-Log "added to user PATH: $binDir"
            }
        }

        # Update the current session PATH so eshyra is immediately usable.
        if ($env:Path -notmatch [regex]::Escape($binDir)) {
            $env:Path = "$binDir;$($env:Path)"
        }

        Write-Step "Verifying install"
        # Bare startup never invokes gameplay or a model. Without provider credentials
        # it exits 1 with setup guidance; with credentials it exits 0 after printing
        # the stable banner/config summary. Either proves the installed command starts.
        $out = ''
        try {
            $out = & $wrapperPath 2>&1 | Out-String
        }
        catch {
            $out = $_.Exception.Message
        }
        if ($out -match 'ANTHROPIC_API_KEY|Eshyra .* core v[0-9]') {
            Write-Log "Eshyra is ready"
        }
        else {
            Write-Warning "Verification did not match expected output; try: eshyra"
        }

        Write-Host "`nEshyra installed ($artifactDir). Open a new terminal and run:`n" -ForegroundColor Green
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
