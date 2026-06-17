# Installing and Updating the Eshyra CLI

This guide is for early non-commercial players who want to run Eshyra locally.
It covers downloading, installing, running, and updating the CLI from
**GitHub Releases**, which is the distribution channel for the pre-1.0 CLI.

Each GitHub Release ships a **self-contained, per-platform archive**. The
archive bundles everything the CLI needs to run, including a pinned Node.js
runtime, so **you do not need to install Node.js or any package manager**. There
is nothing to `npm install`; you download one archive, unpack it, and run the
launcher. The artifact format is recorded in
[ADR-equivalent design on `eshyra-upef`](cli-distribution.md) and the build
lives in `scripts/release/`.

> Eshyra is **source-available and free for non-commercial use** under the
> PolyForm Noncommercial License 1.0.0. It is **not** open source, and
> commercial use requires a separate license. See
> [Licensing](#licensing-and-attribution) below.

## Supported platforms

GitHub Releases publish one archive per supported platform. Pick the archive
that matches your operating system and CPU architecture:

| Platform                         | Archive name                              | Format    |
| -------------------------------- | ----------------------------------------- | --------- |
| Linux x64 (including WSL)        | `eshyra-<version>-linux-x64.tar.gz`       | `.tar.gz` |
| Linux arm64                      | `eshyra-<version>-linux-arm64.tar.gz`     | `.tar.gz` |
| macOS (Apple Silicon / arm64)    | `eshyra-<version>-darwin-arm64.tar.gz`    | `.tar.gz` |
| Windows x64                      | `eshyra-<version>-win32-x64.zip`          | `.zip`    |

Notes:

- **WSL** (Windows Subsystem for Linux) uses the **Linux x64** archive, run from
  inside your WSL distribution — not the Windows `.zip`.
- **macOS is Apple Silicon (arm64) only.** There is no Intel (`darwin-x64`)
  build. On an Intel Mac, Rosetta is not sufficient because the bundled native
  binary targets arm64.
- Each archive ships with a small `<archive>.json` metadata sidecar on the
  Release (version, OS, arch, bundled Node version, unpacked size) you can use to
  confirm you grabbed the right build.

If you are not sure of your architecture: run `uname -m` on Linux/macOS
(`x86_64` → x64, `aarch64`/`arm64` → arm64), or check **Settings → System →
About → System type** on Windows.

## Install

### Linux, macOS, and WSL

1. Open the [latest GitHub Release](https://github.com/jbongaarts/eshyra/releases/latest)
   and download the archive for your platform from the table above.
2. Unpack it into a directory you control, for example `~/.eshyra/app`:

   ```bash
   mkdir -p ~/.eshyra/app
   tar -xzf eshyra-<version>-linux-x64.tar.gz -C ~/.eshyra/app
   ```

   The archive unpacks into a single top-level directory named after the build
   (for example `eshyra-<version>-linux-x64/`).

3. (Optional) Put the launcher on your `PATH` so you can run `eshyra` from
   anywhere. Symlink it rather than copying, so updates are easy:

   ```bash
   ln -sf ~/.eshyra/app/eshyra-<version>-linux-x64/bin/eshyra ~/.local/bin/eshyra
   ```

   Make sure `~/.local/bin` is on your `PATH` (most shells already include it).

4. Verify the install:

   ```bash
   eshyra            # if you linked it onto PATH
   # or, without linking:
   ~/.eshyra/app/eshyra-<version>-linux-x64/bin/eshyra
   ```

   The launcher invokes the **bundled** Node runtime — your system Node (if any)
   is never used.

### Windows (PowerShell)

1. Download `eshyra-<version>-win32-x64.zip` from the
   [latest GitHub Release](https://github.com/jbongaarts/eshyra/releases/latest).
2. Unpack it into a directory you control, for example `%LOCALAPPDATA%\Eshyra\app`:

   ```powershell
   $dest = "$env:LOCALAPPDATA\Eshyra\app"
   New-Item -ItemType Directory -Force -Path $dest | Out-Null
   Expand-Archive -Path .\eshyra-<version>-win32-x64.zip -DestinationPath $dest -Force
   ```

3. Run the bundled launcher (`bin\eshyra.cmd`):

   ```powershell
   & "$env:LOCALAPPDATA\Eshyra\app\eshyra-<version>-win32-x64\bin\eshyra.cmd"
   ```

   To run `eshyra` from anywhere, add the build's `bin` directory to your user
   `PATH` (**Settings → Edit environment variables for your account → Path**),
   then open a new terminal.

## First run

On first run with no provider credential set, the CLI prints setup guidance and
exits — it does not require a repository checkout. Set exactly one provider
credential, then start a campaign:

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
(`~/.eshyra` by default; `%LOCALAPPDATA%\Eshyra` on Windows). You can also run:

```bash
eshyra dolt install
```

Managed install is consent-based; non-interactive shells decline automatically.
Without Dolt, play still works and graceful close reports that no checkpoint was
made. See [CLI Distribution](cli-distribution.md) and
[Local Storage](storage.md).

## Updating

The CLI does not auto-update. To move to a newer release:

1. Download the new archive for your platform from the
   [latest GitHub Release](https://github.com/jbongaarts/eshyra/releases/latest).
2. Unpack it alongside the old one (the top-level directory name includes the
   version, so installs don't collide):

   ```bash
   tar -xzf eshyra-<new-version>-linux-x64.tar.gz -C ~/.eshyra/app
   ```

3. Re-point your launcher symlink (or `PATH` entry) at the new build:

   ```bash
   ln -sf ~/.eshyra/app/eshyra-<new-version>-linux-x64/bin/eshyra ~/.local/bin/eshyra
   ```

   On Windows, update the `Path` entry to the new build's `bin` directory.

4. Confirm the new version runs, then delete the old build directory.

Your campaigns, registry, config, and downloaded Dolt binary live in the data
root (`~/.eshyra` / `%LOCALAPPDATA%\Eshyra`), **not** inside the unpacked
archive, so they are preserved across updates. Replacing the app directory does
not touch your saved campaigns.

## Uninstall

1. Remove the launcher symlink or `PATH` entry.
2. Delete the unpacked archive directory (for example `~/.eshyra/app`).
3. To remove all local data — campaigns, config, and the downloaded Dolt binary
   — delete the data root (`~/.eshyra`, or `%LOCALAPPDATA%\Eshyra` on Windows).
   This is irreversible; back up any campaigns you want to keep first.

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
