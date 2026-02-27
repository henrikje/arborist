# Curl-pipe-bash installer via single script with auto-detection

Date: 2026-02-27

## Context

The `install.sh` script only works from a source checkout with Bun installed. Meanwhile, the publish pipeline already produces pre-built binaries for four platforms (darwin-arm64, darwin-x64, linux-x64, linux-arm64) uploaded to GitHub Releases alongside a `checksums.txt`. Users without Bun or a source checkout cannot use the script. A `curl -fsSL .../install.sh | bash` install path — common in CLI tools — would make Arborist installable with a single command and zero dependencies beyond curl and a shell.

## Options

### Single script with auto-detection

Extend the existing `install.sh` to detect whether it is running from a source checkout or standalone (piped from curl). When `package.json` and `src/index.ts` exist relative to the script's directory, build from source. Otherwise, download a pre-built binary from GitHub Releases.

- **Pros:** Single install URL that always works. No duplication of shell-configuration logic. Existing source-build users are unaffected. Easy to document.
- **Cons:** Script grows from 136 to ~220 lines. Two code paths in one file.

### Separate install-remote.sh script

Create a new `install-remote.sh` for the curl-pipe-bash flow. Keep `install.sh` unchanged for source builds.

- **Pros:** Each script is focused. No risk of breaking the existing source-build path.
- **Cons:** Two scripts to maintain and keep in sync (shared shell-configuration logic). Two URLs to document. Users might use the wrong one.

## Decision

Extend the existing `install.sh` with auto-detection (single script).

## Reasoning

The detection is reliable: when piped from curl, `dirname "$0"` resolves to the current directory or `/dev/stdin`, where `package.json` won't exist. The shared shell-configuration logic — rc-file editing, PATH setup, old-source-line cleanup — stays in one place. One URL to remember and document. This follows the project's "safety and simplicity" principle: fewer moving parts, fewer ways to get it wrong.

Checksum verification was included because the publish workflow already generates `checksums.txt` and `sha256sum`/`shasum` is available on all target platforms. The script warns and continues if neither tool is found rather than failing, keeping the install path robust.

## Consequences

- One install URL works for both source and release installs — no user decision required.
- The script is longer but logically separated into mode-specific blocks that are easy to follow.
- `ARB_VERSION` env var provides a version-pinning mechanism for CI and reproducibility.
- If the tarball naming convention or release structure changes, this script must be updated in sync.
- Homebrew conflict detection is deferred — rare case, user controls PATH order.
