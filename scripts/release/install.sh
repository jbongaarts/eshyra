#!/bin/sh
# Eshyra CLI installer -- POSIX (Linux x64/arm64, macOS Apple Silicon, WSL)
#
# Usage:
#   curl -fsSL https://github.com/jbongaarts/eshyra/releases/latest/download/install.sh | sh
#
# Environment variables (all optional):
#   ESHYRA_VERSION   -- install a specific release tag, e.g. v0.1.0
#                       pass to sh, not curl:
#                         curl -fsSL ...install.sh | ESHYRA_VERSION=v0.1.0 sh
#                       defaults to the latest GitHub Release
#   ESHYRA_BASE_URL  -- override the base download URL (for local testing)
#                       also set ESHYRA_VERSION when using a custom base URL
#                       e.g. file:///path/to/dist-release or http://localhost:8080
#   GITHUB_REPO      -- override the GitHub repository (default: jbongaarts/eshyra)
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
        # Derive the archive name from ESHYRA_VERSION + target; the version
        # defaults to 0.0.0 to match the builder's fallback when no package
        # version is set.
        _ver="${ESHYRA_VERSION:-0.0.0}"
        _ver="${_ver#v}"
        ARCHIVE_NAME="eshyra-${_ver}-${_target}.tar.gz"
        ARCHIVE_URL="${ESHYRA_BASE_URL}/${ARCHIVE_NAME}"
        CHECKSUMS_URL="${ESHYRA_BASE_URL}/sha256sums.txt"
        return
    fi

    # GitHub Releases mode.
    # Query the API to find the actual archive asset URL by target suffix.
    # This intentionally avoids constructing the filename from the tag name,
    # because the artifact's embedded package.json version may differ from the
    # tag (e.g., root package.json has no version field, so the builder uses
    # the fallback "0.0.0").
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
    #   "browser_download_url": "https://.../eshyra-0.0.0-linux-x64.tar.gz"
    # We select by the target-specific suffix, not by constructing the name.
    ARCHIVE_URL=$(printf '%s' "$_release_json" \
        | grep '"browser_download_url"' \
        | grep -- "-${_target}\\.tar\\.gz\"" \
        | head -1 \
        | sed 's/.*"browser_download_url" *: *"\([^"]*\)".*/\1/')

    if [ -z "$ARCHIVE_URL" ]; then
        _tag_found=$(printf '%s' "$_release_json" \
            | grep '"tag_name"' | head -1 \
            | sed 's/.*"tag_name" *: *"\([^"]*\)".*/\1/' || printf 'unknown')
        die "no ${_target} archive found in release ${_tag_found} assets.\nThe release may not have all artifacts yet, or the target is not supported."
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
        log_warn "no checksum entry for ${_name} in sha256sums.txt; skipping"
        return 0
    fi

    _actual=$(sha256_of "$_archive")
    if [ -z "$_actual" ]; then
        log_warn "no SHA-256 tool available (need sha256sum or shasum); skipping verification"
        return 0
    fi

    if [ "$_actual" != "$_expected" ]; then
        die "SHA-256 mismatch for ${_name}:\n  expected: ${_expected}\n  got:      ${_actual}\n\nThe download may be corrupt or tampered. Please retry."
    fi
    log "SHA-256 verified"
}

# ---------- main --------------------------------------------------------------

main() {
    need_cmd curl
    need_cmd tar

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
    checksums="${tmp_dir}/sha256sums.txt"
    if curl -fsSL --retry 3 -o "${checksums}" "${CHECKSUMS_URL}" 2>/dev/null; then
        verify_checksum "${archive}" "${checksums}"
    else
        log_warn "sha256sums.txt not available for this release; skipping checksum verification"
    fi

    log_step "Installing"
    data_home="${XDG_DATA_HOME:-${HOME}/.local/share}"
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
    bin_dir="${HOME}/.local/bin"
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
