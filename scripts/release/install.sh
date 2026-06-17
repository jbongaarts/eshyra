#!/bin/sh
# Eshyra CLI installer -- POSIX (Linux x64/arm64, macOS Apple Silicon, WSL)
#
# Usage:
#   curl -fsSL https://github.com/jbongaarts/eshyra/releases/latest/download/install.sh | sh
#
# Environment variables (all optional):
#   ESHYRA_VERSION   -- install a specific release tag, e.g. v0.1.0
#                       defaults to the latest GitHub Release
#   ESHYRA_BASE_URL  -- override the base download URL (for local testing)
#                       e.g. file:///path/to/dist-release or http://localhost:8080
#                       defaults to https://github.com/<repo>/releases/download/<version>
#   GITHUB_REPO      -- override the GitHub repository (default: jbongaarts/eshyra)
#
# What this script does:
#   1. Detects your OS and CPU architecture.
#   2. Resolves the release version (GitHub API or ESHYRA_VERSION).
#   3. Downloads the matching self-contained archive.
#   4. Verifies the SHA-256 checksum when sha256sums.txt is available.
#   5. Installs to ${XDG_DATA_HOME:-$HOME/.local/share}/eshyra/app/<target>/
#   6. Creates (or repoints) a symlink at $HOME/.local/bin/eshyra.
#   7. Verifies the installed command runs.
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

# ---------- version resolution ------------------------------------------------

resolve_version() {
    if [ -n "${ESHYRA_VERSION:-}" ]; then
        # Accept either 'v0.1.0' or '0.1.0'; artifact names use the bare version.
        v="${ESHYRA_VERSION#v}"
        if [ -z "$v" ]; then
            die "ESHYRA_VERSION is set but empty"
        fi
        printf '%s' "$v"
        return
    fi
    need_cmd curl
    tag=$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" \
        | grep '"tag_name"' \
        | head -1 \
        | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
    if [ -z "$tag" ]; then
        die "could not determine latest release version from the GitHub API -- set ESHYRA_VERSION to install a specific tag"
    fi
    printf '%s' "${tag#v}"
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

    log_step "Resolving version"
    version=$(resolve_version)
    tag="v${version}"
    log "version: ${version} (tag: ${tag})"

    archive_name="eshyra-${version}-${target}.tar.gz"

    if [ -n "${ESHYRA_BASE_URL:-}" ]; then
        base_url="$ESHYRA_BASE_URL"
    else
        base_url="https://github.com/${GITHUB_REPO}/releases/download/${tag}"
    fi
    archive_url="${base_url}/${archive_name}"
    checksums_url="${base_url}/sha256sums.txt"

    log_step "Downloading Eshyra ${version} for ${target}"
    log "from: ${archive_url}"

    tmp_dir=$(mktemp -d)
    # Double-quote to silence shellcheck SC2064; variable is set before trap.
    trap 'rm -rf -- "$tmp_dir"' EXIT

    archive="${tmp_dir}/${archive_name}"
    curl -fsSL --retry 3 -o "${archive}" "${archive_url}" \
        || die "download failed: ${archive_url}"

    log_step "Verifying checksum"
    checksums="${tmp_dir}/sha256sums.txt"
    if curl -fsSL --retry 3 -o "${checksums}" "${checksums_url}" 2>/dev/null; then
        verify_checksum "${archive}" "${checksums}"
    else
        log_warn "sha256sums.txt not available for this release; skipping checksum verification"
    fi

    log_step "Installing"
    data_home="${XDG_DATA_HOME:-${HOME}/.local/share}"
    app_parent="${data_home}/eshyra/app"
    install_dir="${app_parent}/eshyra-${version}-${target}"

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
    # No-config run: should exit 1 and print setup guidance.
    _out=$("${symlink}" 2>&1 || true)
    if printf '%s' "$_out" | grep -q 'ANTHROPIC_API_KEY'; then
        log "Eshyra ${version} is ready"
    else
        log_warn "verification did not match expected output; try running: ${symlink}"
    fi

    printf '\nEshyra %s installed. Run:\n\n  eshyra\n\nSet a provider key to start playing:\n\n  export ANTHROPIC_API_KEY="sk-ant-..."\n  eshyra new "My Campaign"\n  eshyra play\n\n' "${version}"
}

main "$@"
