# Installing and Updating the Eshyra CLI

This guide is for early non-commercial players who want to run Eshyra locally.
It covers installing, running, and updating the CLI from **GitHub Releases**,
which is the distribution channel for the pre-1.0 CLI.

Each GitHub Release ships a **self-contained, per-platform archive** that
bundles everything the CLI needs -- including a pinned Node.js runtime -- so
**you do not need to install Node.js or any package manager**. The one-line
installer handles download, verification, and PATH setup automatically.

> Eshyra is **source-available and free for non-commercial use** under the
> PolyForm Noncommercial License 1.0.0. It is **not** open source, and
> commercial use requires a separate license. See
> [Licensing](#licensing-and-attribution) below.

## Supported platforms

| Platform                         | Archive name                           | Format    |
| -------------------------------- | -------------------------------------- | --------- |
| Linux x64 (including WSL)        | `eshyra-<version>-linux-x64.tar.gz`   | `.tar.gz` |
| Linux arm64                      | `eshyra-<version>-linux-arm64.tar.gz` | `.tar.gz` |
| macOS (Apple Silicon / arm64)    | `eshyra-<version>-darwin-arm64.tar.gz`| `.tar.gz` |
| Windows x64                      | `eshyra-<version>-windows-x64.zip`    | `.zip`    |

Notes:

- **WSL** (Windows Subsystem for Linux) uses the **Linux x64** archive, run
  from inside your WSL distribution -- not the Windows `.zip`.
- **macOS is Apple Silicon (arm64) only.** There is no Intel (`darwin-x64`)
  build. On an Intel Mac, Rosetta is not sufficient because the bundled native
  binary targets arm64.
- Each archive ships with a `<archive>.json` metadata sidecar and a
  `sha256sums.txt` checksum file on the Release. The one-line installer
  verifies checksums automatically.

## Install (one line)

### Linux, macOS, and WSL

```bash
curl -fsSL https://github.com/jbongaarts/eshyra/releases/latest/download/install.sh | sh
```

The installer:
1. Detects your OS and CPU architecture.
2. Queries the GitHub Releases API to find the actual archive URL for your platform.
3. Downloads the archive and verifies its SHA-256 checksum.
4. Installs to `${XDG_DATA_HOME:-$HOME/.local/share}/eshyra/app/eshyra-<version>-<target>/`.
5. Creates (or repoints) a symlink at `$HOME/.local/bin/eshyra`.
6. Prints `export PATH` guidance if `$HOME/.local/bin` is not yet on your PATH.
7. Runs the CLI in no-config mode to confirm the install worked.

It does **not** install Node.js, npm, or any system packages. It does **not**
touch your campaign data.

**To install a specific version**, pass `ESHYRA_VERSION` to `sh` (not to `curl`):
```bash
curl -fsSL https://github.com/jbongaarts/eshyra/releases/latest/download/install.sh | ESHYRA_VERSION=v0.1.0 sh
```

### Windows (PowerShell)

```powershell
irm https://github.com/jbongaarts/eshyra/releases/latest/download/install.ps1 | iex
```

The installer:
1. Detects Windows x64 (AMD64) architecture.
2. Queries the GitHub Releases API to find the actual archive URL for Windows x64.
3. Downloads the archive and verifies its SHA-256 checksum.
4. Installs to `$env:LOCALAPPDATA\Eshyra\app\eshyra-<version>-windows-x64\`.
5. Creates `$env:LOCALAPPDATA\Eshyra\bin\eshyra.cmd` pointing to the installed launcher.
6. Adds `$env:LOCALAPPDATA\Eshyra\bin` to your user PATH if not already present.
7. Updates the current PowerShell session PATH so `eshyra` is immediately usable.
8. Runs the CLI in no-config mode to confirm the install worked.

It does **not** install Node.js, npm, or any system packages. It does **not**
touch your campaign data.

**To install a specific version**, set `$env:ESHYRA_VERSION` before piping
(`-Version` cannot be passed to `iex`):
```powershell
$env:ESHYRA_VERSION = 'v0.1.0'
irm https://github.com/jbongaarts/eshyra/releases/latest/download/install.ps1 | iex
```

## First run

On first run with no provider credential set, the CLI prints setup guidance
and exits cleanly. Set exactly one provider credential, then start a campaign:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."   # or: export CLAUDE_CODE_OAUTH_TOKEN="..."
eshyra new "Emberfall Hollow"
eshyra campaigns list
eshyra play
```

PowerShell:

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
eshyra new "Emberfall Hollow"
eshyra play
```

See the [README](../README.md#configuration) for the full set of environment
variables (data root, model overrides, explicit database paths).

### Checkpoints (Dolt) are optional and self-provisioning

Dolt is **not** bundled in the archive and is **not** required to play. It is
used only for local campaign checkpoints/history on graceful session close, off
the per-turn path. The first time you use a checkpoint feature, the CLI offers
to download a pinned, checksum-verified Dolt binary into your data root
(`~/.local/share/eshyra` by default; `%LOCALAPPDATA%\Eshyra` on Windows). You
can also run:

```bash
eshyra dolt install
```

Managed install is consent-based; non-interactive shells decline automatically.
Without Dolt, play still works and graceful close reports that no checkpoint was
made. See [CLI Distribution](cli-distribution.md) and
[Local Storage](storage.md).

## Updating

Re-run the one-line installer. It detects the latest release, downloads and
verifies the new archive, installs it alongside any prior version (the
directory name includes the version, so they do not collide), and repoints
the `eshyra` command. Your campaigns, registry, config, and downloaded Dolt
binary live in the data root (`~/.local/share/eshyra` / `%LOCALAPPDATA%\Eshyra`),
**not** inside the versioned app directory, so they are always preserved.

```bash
# Same command as install -- idempotent
curl -fsSL https://github.com/jbongaarts/eshyra/releases/latest/download/install.sh | sh
```

PowerShell:
```powershell
irm https://github.com/jbongaarts/eshyra/releases/latest/download/install.ps1 | iex
```

After confirming the new version works, you can remove old versioned
directories from `~/.local/share/eshyra/app/` (Linux/macOS) or
`%LOCALAPPDATA%\Eshyra\app\` (Windows).

## Uninstall

1. Remove the launcher symlink or wrapper:
   - POSIX: `rm ~/.local/bin/eshyra`
   - Windows: delete `%LOCALAPPDATA%\Eshyra\bin\eshyra.cmd`
2. Delete the app directory: `~/.local/share/eshyra/app/` (POSIX) or `%LOCALAPPDATA%\Eshyra\app\` (Windows).
3. Remove `%LOCALAPPDATA%\Eshyra\bin` from your user PATH (Windows).
4. To remove all local data -- campaigns, config, and the downloaded Dolt binary
   -- delete the full data root (`~/.local/share/eshyra` or `%LOCALAPPDATA%\Eshyra`).
   This is irreversible; back up any campaigns you want to keep first.

## Advanced: manual archive install

For offline or air-gapped environments where the one-line installer cannot
reach GitHub:

1. Download the archive for your platform from the
   [latest GitHub Release](https://github.com/jbongaarts/eshyra/releases/latest).
2. Optionally verify the SHA-256 checksum against `sha256sums.txt` on the Release:
   ```bash
   sha256sum -c --ignore-missing sha256sums.txt
   ```
3. Unpack and run:
   ```bash
   tar -xzf eshyra-<version>-linux-x64.tar.gz -C ~/.local/share/eshyra/app
   ~/.local/share/eshyra/app/eshyra-<version>-linux-x64/bin/eshyra
   ```
4. Optionally create the symlink yourself:
   ```bash
   ln -sf ~/.local/share/eshyra/app/eshyra-<version>-linux-x64/bin/eshyra ~/.local/bin/eshyra
   ```

Windows (PowerShell):
```powershell
Expand-Archive -Path eshyra-<version>-windows-x64.zip -DestinationPath "$env:LOCALAPPDATA\Eshyra\app" -Force
& "$env:LOCALAPPDATA\Eshyra\app\eshyra-<version>-windows-x64\bin\eshyra.cmd"
```

## Licensing and attribution

Eshyra is **source-available and free for non-commercial use** under the
**PolyForm Noncommercial License 1.0.0**. It is **not** open source.
**Commercial use requires separate written permission or a commercial license.**

- Source-code license: [LICENSE](../LICENSE)
- Commercial rights / commercial-license terms:
  [COMMERCIAL-LICENSE.md](../COMMERCIAL-LICENSE.md)
- Full licensing breakdown, including the content/source split:
  [docs/licensing.md](licensing.md)

**Bundled content carries its own licenses and attribution, separate from the
Eshyra source-code license.** Each archive includes a `NOTICE` file with the
required attributions. In particular, the bundled **D&D System Reference
Document 5.1** content is licensed under **CC BY 4.0** and must retain its
attribution. Bundled-runtime notices for Node.js, `better-sqlite3`, and the
Claude Agent SDK ship under `THIRD-PARTY/` inside the archive. Review the
`NOTICE` and `THIRD-PARTY/` files distributed with your download.
