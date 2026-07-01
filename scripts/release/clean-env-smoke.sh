#!/usr/bin/env bash
#
# Clean-environment release artifact smoke test (ADR 0016 / bead eshyra-w7bp).
#
# Proves the self-contained release artifact runs on a machine that GENUINELY
# lacks a native build toolchain -- not merely with a restricted PATH on a
# toolchain-equipped runner, which is all validate-release-artifact.mjs and the
# installer-smoke job can assert (they run on GitHub-hosted images that always
# have gcc/make/python3 on disk).
#
# It unpacks the linux-x64 artifact on the host, then runs the bundled launcher
# (bin/eshyra, which execs the bundled runtime/node) INSIDE a minimal Debian
# container that has no C/C++ toolchain, no python, and no system Node. The
# container first self-checks that those tools are absent (so the proof fails
# loudly if the base image ever ships them), then runs the launcher with a
# scrubbed environment and asserts the documented no-config behavior: exit 1
# with setup guidance.
#
# Linux-only by design: the bundled Node is a glibc linux-x64 binary, and a
# Debian slim image is glibc-based (musl images like Alpine would fail to run
# it). Windows/macOS GitHub-hosted runners ship toolchains by default and
# cannot be made toolchain-free without self-hosted runners (ADR 0016), so this
# check scopes to linux-x64.
#
# Usage:
#   scripts/release/clean-env-smoke.sh [path-to-linux-x64-artifact.tar.gz]
# With no argument it uses the newest dist-release/eshyra-*-linux-x64.tar.gz.
#
# Overridable via env:
#   CONTAINER_ENGINE       container CLI (default: docker; e.g. podman)
#   CLEAN_ENV_SMOKE_IMAGE  base image (default: debian:bookworm-slim)

set -euo pipefail

engine="${CONTAINER_ENGINE:-docker}"
image="${CLEAN_ENV_SMOKE_IMAGE:-debian:bookworm-slim}"

if ! command -v "$engine" >/dev/null 2>&1; then
  echo "clean-env smoke: container engine '$engine' not found on PATH." >&2
  echo "Install Docker (or set CONTAINER_ENGINE=podman) to run this smoke." >&2
  exit 127
fi

# Locate the linux-x64 artifact: explicit arg, else newest matching tarball.
archive="${1:-}"
if [ -z "$archive" ]; then
  # Search dist-release recursively so this works whether the tarball sits
  # directly in dist-release/ (local `npm run release:build`) or one level down
  # (however actions/download-artifact lays it out in CI).
  archive="$(find dist-release -type f -name 'eshyra-*-linux-x64.tar.gz' 2>/dev/null | sort | tail -n1 || true)"
fi
if [ -z "$archive" ] || [ ! -f "$archive" ]; then
  echo "clean-env smoke: no linux-x64 artifact found." >&2
  echo "Pass one as an argument, or build first: npm run release:build -- --edition api" >&2
  exit 1
fi
echo "clean-env smoke: artifact = $archive"
echo "clean-env smoke: engine = $engine, image = $image"

workdir="$(mktemp -d)"
cleanup() { rm -rf "$workdir"; }
trap cleanup EXIT

# Unpack on the host (the host has tar/gzip); the container only needs to RUN
# the already-unpacked tree, so it never needs archiving tools of its own.
tar -xf "$archive" -C "$workdir"
appdir="$(find "$workdir" -mindepth 1 -maxdepth 1 -type d | head -n1)"
if [ -z "$appdir" ]; then
  echo "clean-env smoke: archive did not contain a top-level directory" >&2
  exit 1
fi
echo "clean-env smoke: unpacked to $appdir"

# Run the launcher inside the toolchain-free container. The artifact is mounted
# read-only (the CLI never writes into its own install tree); HOME points at a
# writable throwaway so the no-config path can resolve a data root without
# inheriting any real config.
"$engine" run --rm \
  -v "$appdir":/artifact:ro \
  "$image" \
  /bin/sh -euc '
    echo "--- proving the container is toolchain-free ---"
    for tool in gcc cc c++ g++ clang make cmake python python3 node nodejs npm node-gyp; do
      if command -v "$tool" >/dev/null 2>&1; then
        echo "FAIL: unexpected build tool present in supposedly clean env: $tool ($(command -v "$tool"))" >&2
        exit 2
      fi
    done
    echo "confirmed: no gcc/cc/make/cmake/python/python3/node/npm/node-gyp on PATH"

    echo "--- running the bundled launcher with a scrubbed, no-config environment ---"
    # env -i clears ALL inherited env (no ANTHROPIC_API_KEY / ESHYRA_* leak);
    # HOME is a fresh writable dir; PATH is minimal system dirs. The launcher
    # prepends its own bundled runtime/ and execs runtime/node.
    set +e
    out="$(env -i HOME=/tmp/eshyra-home PATH=/usr/bin:/bin /artifact/bin/eshyra 2>&1)"
    code=$?
    set -e
    printf "%s\n" "$out"

    if [ "$code" -ne 1 ]; then
      echo "FAIL: expected the no-config launcher to exit 1, got $code" >&2
      exit 1
    fi
    for needle in "Eshyra" "ANTHROPIC_API_KEY" "eshyra play"; do
      case "$out" in
        *"$needle"*) : ;;
        *)
          echo "FAIL: launcher output missing expected text: $needle" >&2
          exit 1
          ;;
      esac
    done
    echo "PASS: bundled artifact ran on its own runtime in a toolchain-free env (exit 1 + setup guidance)"
  '

echo "clean-env smoke: OK"
