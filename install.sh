#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

log()     { printf '%s\n' "$*"; }
success() { printf "${GREEN}%s${NC}\n" "$*"; }
warn()    { printf "${YELLOW}%s${NC}\n" "$*"; }
error()   { printf "${RED}%s${NC}\n" "$*" >&2; }

REPO="henrikje/arborist"
BIN_DIR="$HOME/.local/bin"
SHARE_DIR="$HOME/.local/share/arb"

# ── Mode detection ───────────────────────────────────────────────
# When run from a source checkout, package.json and src/index.ts
# exist next to the script. When piped from curl, they don't.

SCRIPT_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)" || SCRIPT_DIR=""
if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/package.json" && -f "$SCRIPT_DIR/src/index.ts" ]]; then
    INSTALL_MODE=source
else
    INSTALL_MODE=release
fi

# ── Detect login shell ───────────────────────────────────────────

USER_SHELL=""
case "$SHELL" in
    */zsh)  USER_SHELL=zsh ;;
    */bash) USER_SHELL=bash ;;
esac

# ── Helper functions ─────────────────────────────────────────────

download() {
    local url="$1" dest="$2"
    if command -v curl &>/dev/null; then
        curl -fsSL -o "$dest" "$url"
    elif command -v wget &>/dev/null; then
        wget -qO "$dest" "$url"
    else
        error "Neither curl nor wget found. Install one and try again."
        exit 1
    fi
}

download_to_stdout() {
    local url="$1"
    if command -v curl &>/dev/null; then
        curl -fsSL "$url"
    elif command -v wget &>/dev/null; then
        wget -qO- "$url"
    else
        error "Neither curl nor wget found. Install one and try again."
        exit 1
    fi
}

detect_platform() {
    local os arch
    os="$(uname -s)"
    arch="$(uname -m)"

    case "$os" in
        Darwin) os=darwin ;;
        Linux)  os=linux ;;
        *)
            error "Unsupported operating system: $os"
            error "Arborist supports macOS and Linux."
            exit 1
            ;;
    esac

    case "$arch" in
        arm64|aarch64) arch=arm64 ;;
        x86_64)        arch=x64 ;;
        *)
            error "Unsupported architecture: $arch"
            error "Arborist supports x64 and arm64."
            exit 1
            ;;
    esac

    printf '%s-%s' "$os" "$arch"
}

detect_version() {
    if [[ -n "${ARB_VERSION:-}" ]]; then
        printf '%s' "$ARB_VERSION"
        return
    fi

    local api_url="https://api.github.com/repos/$REPO/releases/latest"
    local response
    response="$(download_to_stdout "$api_url")"

    local tag
    tag="$(printf '%s' "$response" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"

    if [[ -z "$tag" ]]; then
        error "Failed to determine latest version from GitHub."
        error "Set ARB_VERSION to install a specific version."
        exit 1
    fi

    # Strip leading v if present
    printf '%s' "${tag#v}"
}

verify_checksum() {
    local file="$1" expected="$2"
    local actual

    if command -v sha256sum &>/dev/null; then
        actual="$(sha256sum "$file" | cut -d' ' -f1)"
    elif command -v shasum &>/dev/null; then
        actual="$(shasum -a 256 "$file" | cut -d' ' -f1)"
    else
        warn "Neither sha256sum nor shasum found — skipping checksum verification."
        return 0
    fi

    if [[ "$actual" != "$expected" ]]; then
        error "Checksum verification failed!"
        error "Expected: $expected"
        error "Actual:   $actual"
        exit 1
    fi
}

install_from_release() {
    local platform version
    platform="$(detect_platform)"
    version="$(detect_version)"

    local tarball_name="arb-${version}-${platform}"
    local tarball_url="https://github.com/$REPO/releases/download/v${version}/${tarball_name}.tar.gz"
    local checksums_url="https://github.com/$REPO/releases/download/v${version}/checksums.txt"

    log "Installing arb v${version} for ${platform}..."

    tmp_dir="$(mktemp -d)"
    trap 'rm -rf "$tmp_dir"' EXIT

    download "$tarball_url" "$tmp_dir/${tarball_name}.tar.gz"

    # Verify checksum
    local checksums_file="$tmp_dir/checksums.txt"
    if download "$checksums_url" "$checksums_file" 2>/dev/null; then
        local expected_checksum
        expected_checksum="$(grep -F "${tarball_name}.tar.gz" "$checksums_file" | cut -d' ' -f1)"
        if [[ -n "$expected_checksum" ]]; then
            verify_checksum "$tmp_dir/${tarball_name}.tar.gz" "$expected_checksum"
            log "Checksum verified."
        else
            warn "Tarball not found in checksums.txt — skipping verification."
        fi
    else
        warn "Could not download checksums.txt — skipping verification."
    fi

    tar -xzf "$tmp_dir/${tarball_name}.tar.gz" -C "$tmp_dir"

    BINARY_SRC="$tmp_dir/${tarball_name}/arb"
    SHELL_SRC="$tmp_dir/${tarball_name}/shell"
    ARB_VERSION="$version"
}

# ── Install ──────────────────────────────────────────────────────

if [[ "$INSTALL_MODE" == "source" ]]; then
    # ── Build from source ────────────────────────────────────────
    if ! command -v bun &>/dev/null; then
        error "bun is not installed — cannot build from source"
        error "Install bun: https://bun.sh"
        exit 1
    fi

    log "Building from source..."
    (cd "$SCRIPT_DIR" && bun install && bun run build)

    BINARY_SRC="$SCRIPT_DIR/dist/arb"
    SHELL_SRC="$SCRIPT_DIR/shell"
else
    # ── Download from GitHub Releases ────────────────────────────
    install_from_release
fi

# ── Install binary ────────────────────────────────────────────────

mkdir -p "$BIN_DIR"

cp "$BINARY_SRC" "$BIN_DIR/arb"
chmod +x "$BIN_DIR/arb"
log "Installed arb to $BIN_DIR/arb"

# ── Install shell files ──────────────────────────────────────────

mkdir -p "$SHARE_DIR"
cp "$SHELL_SRC/arb.zsh" "$SHARE_DIR/arb.zsh"
cp "$SHELL_SRC/arb.bash" "$SHARE_DIR/arb.bash"
log "Installed shell files to $SHARE_DIR/"

# ── Configure shell ───────────────────────────────────────────────

__arb_configure_rc() {
    local rc_file="$1" shell_file="$2" rc_name="$3"
    local ARB_MARKER="# Added by Arborist"
    local PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
    local SOURCE_LINE="source \"\$HOME/.local/share/arb/$shell_file\""

    # Remove old source lines pointing at repo checkout if present
    if [[ "$INSTALL_MODE" == "source" ]]; then
        local OLD_ZSH_SOURCE="source \"$SCRIPT_DIR/shell/arb.zsh\""
        local OLD_BASH_SOURCE="source \"$SCRIPT_DIR/shell/arb.bash\""
        local old_line
        for old_line in "$OLD_ZSH_SOURCE" "$OLD_BASH_SOURCE"; do
            if [[ -f "$rc_file" ]] && grep -qF "$old_line" "$rc_file"; then
                sed -i '' "\|$old_line|d" "$rc_file" 2>/dev/null || \
                    sed -i "\|$old_line|d" "$rc_file" 2>/dev/null || true
                log "Removed old source line from $rc_name"
            fi
        done
    fi

    # Add Arborist block if not already present
    if [[ -f "$rc_file" ]] && grep -qF "$ARB_MARKER" "$rc_file"; then
        warn "Arborist block already present in $rc_name, skipping"
    else
        local ARB_BLOCK="$ARB_MARKER"
        case ":$PATH:" in
            *":$BIN_DIR:"*) ;;
            *) ARB_BLOCK="$ARB_BLOCK"$'\n'"$PATH_LINE" ;;
        esac
        ARB_BLOCK="$ARB_BLOCK"$'\n'"$SOURCE_LINE"

        if [[ -f "$rc_file" ]] && [[ "$(tail -c 2 "$rc_file")" != "" ]]; then
            printf '\n' >> "$rc_file"
        fi
        printf '%s\n' "$ARB_BLOCK" >> "$rc_file"
        log "Added Arborist block to $rc_name"
    fi
}

case "$USER_SHELL" in
    zsh)
        __arb_configure_rc "$HOME/.zshrc" "arb.zsh" ".zshrc"
        ;;
    bash)
        # macOS Terminal.app opens login shells that source .bash_profile but not .bashrc
        if [[ "$(uname)" == "Darwin" ]]; then
            __arb_configure_rc "$HOME/.bash_profile" "arb.bash" ".bash_profile"
        else
            __arb_configure_rc "$HOME/.bashrc" "arb.bash" ".bashrc"
        fi
        ;;
esac

# ── Done ──────────────────────────────────────────────────────────

echo ""
success "Installation complete!"
echo ""
case "$USER_SHELL" in
    zsh)
        echo "  Restart your shell or run 'source ~/.zshrc'."
        ;;
    bash)
        if [[ "$(uname)" == "Darwin" ]]; then
            echo "  Restart your shell or run 'source ~/.bash_profile'."
        else
            echo "  Restart your shell or run 'source ~/.bashrc'."
        fi
        ;;
    *)
        warn "Your shell ($SHELL) was not auto-configured."
        warn "Add the following to your shell profile manually:"
        echo ""
        case ":$PATH:" in
            *":$BIN_DIR:"*) ;;
            *) echo "  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
        esac
        echo ""
        echo "  For bash: source \"\$HOME/.local/share/arb/arb.bash\""
        echo "  For zsh:  source \"\$HOME/.local/share/arb/arb.zsh\""
        ;;
esac
echo "  Then run 'arb init' in a project directory to get started."
echo ""
