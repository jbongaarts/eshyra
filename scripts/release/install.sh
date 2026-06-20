#!/bin/sh
# Eshyra CLI installer -- POSIX (Linux x64/arm64, macOS Apple Silicon, WSL)
#
# Usage:
#   curl -fsSL https://github.com/jbongaarts/eshyra/releases/latest/download/install.sh | sh
#   curl -fsSL ...install.sh | sh -s -- --edition codex
#
# Editions (ADR 0011) -- pick which gameplay provider binaries are bundled:
#   api    -- lean: api-native SDKs only, no bundled agent CLI binary (smallest)
#   claude -- Claude Agent SDK (Claude Code CLI) bundled   [DEFAULT]
#   codex  -- Codex SDK (@openai/codex CLI) bundled
#   full   -- both agent binaries bundled
# Select with `--edition <name>`, or ESHYRA_EDITION=<name>. With an interactive
# TTY and no selection, the installer prompts (default: claude).
#
# Environment variables (all optional):
#   ESHYRA_EDITION   -- which edition to install (api|claude|codex|full)
#                       defaults to claude; --edition overrides it
#   ESHYRA_VERSION   -- install a specific release tag, e.g. v0.1.0
#                       pass to sh, not curl:
#                         curl -fsSL ...install.sh | ESHYRA_VERSION=v0.1.0 sh
#                       defaults to the latest GitHub Release
#   ESHYRA_BASE_URL  -- override the base download URL (for local testing)
#                       also set ESHYRA_VERSION when using a custom base URL
#                       e.g. file:///path/to/dist-release or http://localhost:8080
#   GITHUB_REPO      -- override the GitHub repository (default: jbongaarts/eshyra)
#
# Test/development support only (NOT a normal user install path):
#   ESHYRA_INSTALL_ROOT -- override the data-home base the app tree installs into
#                          (defaults to XDG_DATA_HOME or $HOME/.local/share)
#   ESHYRA_BIN_DIR      -- override the directory the `eshyra` symlink is created
#                          in (defaults to $HOME/.local/bin)
#   ESHYRA_SKIP_CHECKSUM=1 -- skip SHA-256 verification entirely. For local
#                          build/test loops only; never use this for a real
#                          install. Checksum verification is mandatory whenever
#                          the release publishes sha256sums.txt.
#
# What this script does:
#   1. Detects your OS and CPU architecture.
#   2. Queries the GitHub Releases API to find the actual archive URL for your
#      platform (asset discovery -- does not assume the archive name matches the
#      tag name, since the package version embedded in the artifact may differ).
#   3. Downloads the archive and verifies its SHA-256 checksum.
#   4. Installs to ${XDG_DATA_HOME:-$HOME/.local/share}/eshyra/app/<artifact-name>/
#   5. Creates (or repoints) a symlink at $HOME/.local/bin/eshyra.
#   6. Verifies the installed command runs.
#
# Supported targets:
#   linux-x64    (including WSL on x64 Windows)
#   linux-arm64
#   darwin-arm64 (macOS Apple Silicon only; Intel macOS is not supported)
#
# This script does NOT require Node.js, npm, or any system package manager.
# Dolt (for campaign checkpoints) is NOT installed here -- it is self-provisioning.

set -eu

GITHUB_REPO="${GITHUB_REPO:-jbongaarts/eshyra}"

# Single named default edition (ADR 0011). Keep in lockstep with editions.mjs
# DEFAULT_EDITION; releaseInstallerPolicy.test.ts guards that they match.
ESHYRA_DEFAULT_EDITION="claude"

# ---------- helpers -----------------------------------------------------------

die() { printf '\nerror: %s\n\n' "$1" >&2; exit 1; }
log() { printf '  %s\n' "$1"; }
log_step() { printf '\n==> %s\n' "$1"; }
log_warn() { printf 'warning: %s\n' "$1" >&2; }

need_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        die "required command not found: $1 -- please install it and retry"
    fi
}

# ---------- platform detection ------------------------------------------------

detect_platform() {
    kernel=$(uname -s 2>/dev/null || printf 'unknown')
    machine=$(uname -m 2>/dev/null || printf 'unknown')

    case "$kernel" in
        Linux)  os="linux" ;;
        Darwin) os="darwin" ;;
        *)      die "unsupported operating system: ${kernel} (supported: Linux, macOS)" ;;
    esac

    case "$machine" in
        x86_64)         arch="x64" ;;
        aarch64|arm64)  arch="arm64" ;;
        *)              die "unsupported CPU architecture: ${machine} (supported: x86_64, aarch64)" ;;
    esac

    if [ "$os" = "darwin" ] && [ "$arch" = "x64" ]; then
        die "Intel macOS (darwin-x64) is not supported. Only Apple Silicon (darwin-arm64) builds ship. Consider running Eshyra from source on an Intel Mac."
    fi

    printf '%s-%s' "$os" "$arch"
}

# ---------- edition selection -------------------------------------------------
# Resolves which edition to install: --edition flag > ESHYRA_EDITION env >
# interactive prompt (TTY only) > ESHYRA_DEFAULT_EDITION. Sets the EDITION global.

EDITION=""

validate_edition() {
    case "$1" in
        api|claude|codex|full) return 0 ;;
        *) die "unknown edition: \"$1\" (supported: api, claude, codex, full)" ;;
    esac
}

# CLI flag parsing (only --edition is recognized; everything else is an error so
# typos surface). Sets EDITION_FLAG when present.
EDITION_FLAG=""
parse_args() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --edition)
                shift
                [ "$#" -gt 0 ] || die "--edition requires a value (api|claude|codex|full)"
                EDITION_FLAG="$1"
                ;;
            --edition=*)
                EDITION_FLAG="${1#--edition=}"
                ;;
            -h|--help)
                printf 'Usage: install.sh [--edition api|claude|codex|full]\n'
                exit 0
                ;;
            *)
                die "unknown argument: $1 (supported: --edition <name>)"
                ;;
        esac
        shift
    done
}

prompt_edition() {
    # Only prompt when stdin is an interactive terminal; piped installs
    # (curl ... | sh) are non-interactive and fall through to the default.
    if [ -t 0 ]; then
        printf '\nSelect an Eshyra edition (gameplay provider binaries to bundle):\n' >&2
        printf '  api    - lean, no agent CLI binary (smallest)\n' >&2
        printf '  claude - Claude Agent SDK [default]\n' >&2
        printf '  codex  - Codex CLI\n' >&2
        printf '  full   - both agent binaries\n' >&2
        printf 'edition [%s]: ' "$ESHYRA_DEFAULT_EDITION" >&2
        read -r _choice || _choice=""
        if [ -n "$_choice" ]; then
            printf '%s' "$_choice"
            return
        fi
    fi
    printf '%s' "$ESHYRA_DEFAULT_EDITION"
}

resolve_edition() {
    # Precedence: --edition flag, then ESHYRA_EDITION env, then prompt/default.
    if [ -n "$EDITION_FLAG" ]; then
        EDITION="$EDITION_FLAG"
    elif [ -n "${ESHYRA_EDITION:-}" ]; then
        EDITION="$ESHYRA_EDITION"
    else
        EDITION=$(prompt_edition)
    fi
    validate_edition "$EDITION"
}

# ---------- archive URL resolution --------------------------------------------
# Sets three globals: ARCHIVE_URL, ARCHIVE_NAME, CHECKSUMS_URL.
# Using globals avoids subshell/pipe issues with command substitution in sh.

ARCHIVE_URL=""
ARCHIVE_NAME=""
CHECKSUMS_URL=""

resolve_urls() {
    _target="$1"

    if [ -n "${ESHYRA_BASE_URL:-}" ]; then
        # Custom base URL mode (local testing or staging).
        # Derive the archive name from EDITION + ESHYRA_VERSION + target; the
        # version defaults to 0.0.0-dev to match the builder's sentinel fallback
        # when no release version is injected (untagged dev/local builds).
        _ver="${ESHYRA_VERSION:-0.0.0-dev}"
        _ver="${_ver#v}"
        ARCHIVE_NAME="eshyra-${EDITION}-${_ver}-${_target}.tar.gz"
        ARCHIVE_URL="${ESHYRA_BASE_URL}/${ARCHIVE_NAME}"
        CHECKSUMS_URL="${ESHYRA_BASE_URL}/sha256sums.txt"
        return
    fi

    # GitHub Releases mode.
    # Query the API to find the actual archive asset URL by target suffix.
    # This intentionally avoids constructing the filename from the tag name:
    # the released artifact is named by the builder's resolved version, which is
    # the tag with its leading "v" stripped (e.g. tag v0.1.0 -> eshyra-0.1.0-…).
    # Selecting the asset by target suffix is robust to that normalization.
    need_cmd curl

    if [ -n "${ESHYRA_VERSION:-}" ]; then
        _tag="v${ESHYRA_VERSION#v}"
        _api_url="https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${_tag}"
    else
        _api_url="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"
    fi

    log "querying: ${_api_url}"
    _release_json=$(curl -fsSL "$_api_url") \
        || die "failed to fetch release info from GitHub API: ${_api_url}"

    # The API response has lines like:
    #   "browser_download_url": "https://.../eshyra-claude-0.1.0-linux-x64.tar.gz"
    # We select by the edition PREFIX and the target-specific suffix, not by
    # constructing the full name (the version segment is the builder's resolved
    # version, which we do not know here). Each Release carries one archive per
    # edition x target, so prefix+suffix uniquely identifies the asset.
    ARCHIVE_URL=$(printf '%s' "$_release_json" \
        | grep '"browser_download_url"' \
        | grep -- "/eshyra-${EDITION}-" \
        | grep -- "-${_target}\\.tar\\.gz\"" \
        | head -1 \
        | sed 's/.*"browser_download_url" *: *"\([^"]*\)".*/\1/')

    if [ -z "$ARCHIVE_URL" ]; then
        _tag_found=$(printf '%s' "$_release_json" \
            | grep '"tag_name"' | head -1 \
            | sed 's/.*"tag_name" *: *"\([^"]*\)".*/\1/' || printf 'unknown')
        die "no ${EDITION} ${_target} archive found in release ${_tag_found} assets.\nThe release may not have all artifacts/editions yet, or the target is not supported."
    fi

    ARCHIVE_NAME=$(basename "$ARCHIVE_URL")

    # Find the sha256sums.txt URL in the assets list; fall back to sibling URL.
    CHECKSUMS_URL=$(printf '%s' "$_release_json" \
        | grep '"browser_download_url"' \
        | grep 'sha256sums\.txt' \
        | head -1 \
        | sed 's/.*"browser_download_url" *: *"\([^"]*\)".*/\1/')

    if [ -z "$CHECKSUMS_URL" ]; then
        CHECKSUMS_URL="${ARCHIVE_URL%/*}/sha256sums.txt"
    fi
}

# ---------- checksum verification ---------------------------------------------

sha256_of() {
    _file="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$_file" | cut -d' ' -f1
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$_file" | cut -d' ' -f1
    else
        printf ''
    fi
}

verify_checksum() {
    _archive="$1"
    _sums="$2"
    _name=$(basename "$_archive")

    # sha256sums.txt format: "<hash>  <filename>" (two spaces, standard sha256sum output)
    _expected=$(grep "  ${_name}$" "$_sums" 2>/dev/null | cut -d' ' -f1 || printf '')
    if [ -z "$_expected" ]; then
        # Fail closed: the release publishes a checksum file but it has no entry
        # for the archive we are about to install, so we cannot verify it.
        die "no checksum entry for ${_name} in sha256sums.txt.
The release publishes checksums but none matches the archive being installed.
Refusing to install an unverifiable download (it may be corrupt or tampered)."
    fi

    _actual=$(sha256_of "$_archive")
    if [ -z "$_actual" ]; then
        # Fail closed: we have an expected hash but no way to compute the actual
        # one. Silently installing would defeat the point of publishing checksums.
        die "checksums are published for this release but no SHA-256 tool is available.
Install 'sha256sum' (GNU coreutils) or 'shasum' (perl) and retry so the
download can be verified before installation."
    fi

    if [ "$_actual" != "$_expected" ]; then
        die "SHA-256 mismatch for ${_name}:
  expected: ${_expected}
  got:      ${_actual}

The download may be corrupt or tampered. Please retry."
    fi
    log "SHA-256 verified"
}

# ---------- main --------------------------------------------------------------

main() {
    need_cmd curl
    need_cmd tar

    parse_args "$@"

    log_step "Selecting edition"
    resolve_edition
    log "edition: ${EDITION}"

    log_step "Detecting platform"
    target=$(detect_platform)
    log "platform: ${target}"

    log_step "Resolving release"
    resolve_urls "$target"
    log "archive: ${ARCHIVE_NAME}"
    log "from:    ${ARCHIVE_URL}"

    tmp_dir=$(mktemp -d)
    # Double-quote to silence shellcheck SC2064; variable is set before trap.
    trap 'rm -rf -- "$tmp_dir"' EXIT

    log_step "Downloading"
    archive="${tmp_dir}/${ARCHIVE_NAME}"
    curl -fsSL --retry 3 -o "${archive}" "${ARCHIVE_URL}" \
        || die "download failed: ${ARCHIVE_URL}"

    log_step "Verifying checksum"
    if [ "${ESHYRA_SKIP_CHECKSUM:-}" = "1" ]; then
        log_warn "ESHYRA_SKIP_CHECKSUM=1 set; skipping checksum verification (test/dev only)"
    else
        checksums="${tmp_dir}/sha256sums.txt"
        if curl -fsSL --retry 3 -o "${checksums}" "${CHECKSUMS_URL}" 2>/dev/null; then
            # Checksums published -> verification is mandatory and fails closed.
            verify_checksum "${archive}" "${checksums}"
        else
            # No checksum file at all: this release predates published checksums.
            # We cannot verify, so warn loudly but allow the install to proceed.
            log_warn "sha256sums.txt could not be downloaded; this release predates published checksums, so the download cannot be verified. Continuing without verification."
        fi
    fi

    log_step "Installing"
    # ESHYRA_INSTALL_ROOT is a test/dev knob so smoke tests can install into a
    # throwaway directory instead of the user's real data home.
    data_home="${ESHYRA_INSTALL_ROOT:-${XDG_DATA_HOME:-${HOME}/.local/share}}"
    app_parent="${data_home}/eshyra/app"
    # The artifact name (minus .tar.gz) is the top-level directory inside the archive.
    artifact_dir="${ARCHIVE_NAME%.tar.gz}"
    install_dir="${app_parent}/${artifact_dir}"

    mkdir -p "${app_parent}"

    if [ -e "${install_dir}" ]; then
        rm -rf -- "${install_dir}"
    fi

    tar -xzf "${archive}" -C "${app_parent}"
    log "installed: ${install_dir}"

    log_step "Creating command"
    # ESHYRA_BIN_DIR is a test/dev knob so smoke tests do not touch the user's
    # real ~/.local/bin (and therefore their PATH).
    bin_dir="${ESHYRA_BIN_DIR:-${HOME}/.local/bin}"
    mkdir -p "${bin_dir}"
    symlink="${bin_dir}/eshyra"
    ln -sf "${install_dir}/bin/eshyra" "${symlink}"
    log "symlink: ${symlink}"

    case ":${PATH}:" in
        *":${bin_dir}:"*)
            ;;
        *)
            printf '\n'
            printf '  %s is not on your PATH yet.\n' "${bin_dir}"
            printf '  Add this line to your shell profile (~/.bashrc, ~/.zshrc, etc.):\n\n'
            printf '    export PATH="%s:$PATH"\n\n' "${bin_dir}"
            printf '  Then reload your shell (source ~/.bashrc) or open a new terminal.\n'
            ;;
    esac

    log_step "Verifying install"
    # No-config run: should exit 1 and print setup guidance including ANTHROPIC_API_KEY.
    _out=$("${symlink}" 2>&1 || true)
    if printf '%s' "$_out" | grep -q 'ANTHROPIC_API_KEY'; then
        log "Eshyra is ready"
    else
        log_warn "verification did not match expected output; try running: ${symlink}"
    fi

    printf '\nEshyra installed (%s). Run:\n\n  eshyra\n\nSet a provider key to start playing:\n\n  export ANTHROPIC_API_KEY="sk-ant-..."\n  eshyra new "My Campaign"\n  eshyra play\n\n' "${artifact_dir}"
}

main "$@"
