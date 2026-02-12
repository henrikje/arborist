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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$HOME/.local/bin"
SHARE_DIR="$HOME/.local/share/arb"

# ── Pre-flight checks ────────────────────────────────────────────

if [[ "$SHELL" != */zsh ]] && ! command -v zsh &>/dev/null; then
    warn "zsh is required for the shell function and tab completion"
    warn "The arb script itself works in any shell"
fi

# ── Build if needed ───────────────────────────────────────────────

if [[ ! -f "$SCRIPT_DIR/dist/arb" ]]; then
    if ! command -v bun &>/dev/null; then
        error "dist/arb not found and bun is not installed — cannot build"
        error "Install bun (https://bun.sh) and run: bun run build"
        exit 1
    fi
    log "dist/arb not found, building..."
    (cd "$SCRIPT_DIR" && bun install && bun run build)
fi

# ── Install binary ────────────────────────────────────────────────

mkdir -p "$BIN_DIR"

cp "$SCRIPT_DIR/dist/arb" "$BIN_DIR/arb"
chmod +x "$BIN_DIR/arb"
log "Installed arb to $BIN_DIR/arb"

# ── Install shell function ────────────────────────────────────────

mkdir -p "$SHARE_DIR"
cp "$SCRIPT_DIR/shell/arb.zsh" "$SHARE_DIR/arb.zsh"
log "Installed arb.zsh to $SHARE_DIR/arb.zsh"

# ── Configure shell ───────────────────────────────────────────────

ZSHRC="$HOME/.zshrc"
ARB_MARKER="# Added by Arborist"
PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
SOURCE_LINE='source "$HOME/.local/share/arb/arb.zsh"'
OLD_SOURCE_LINE="source \"$SCRIPT_DIR/shell/arb.zsh\""

# Remove old source line pointing at repo checkout if present
if [[ -f "$ZSHRC" ]] && grep -qF "$OLD_SOURCE_LINE" "$ZSHRC"; then
    sed -i '' "\|$OLD_SOURCE_LINE|d" "$ZSHRC" 2>/dev/null || true
    log "Removed old source line from .zshrc"
fi

# Add Arborist block if not already present
if [[ -f "$ZSHRC" ]] && grep -qF "$ARB_MARKER" "$ZSHRC"; then
    warn "Arborist block already present in .zshrc, skipping"
else
    ARB_BLOCK="$ARB_MARKER"
    case ":$PATH:" in
        *":$BIN_DIR:"*) ;;
        *) ARB_BLOCK="$ARB_BLOCK"$'\n'"$PATH_LINE" ;;
    esac
    ARB_BLOCK="$ARB_BLOCK"$'\n'"$SOURCE_LINE"

    if [[ -f "$ZSHRC" ]] && [[ "$(tail -c 2 "$ZSHRC")" != "" ]]; then
        printf '\n' >> "$ZSHRC"
    fi
    printf '%s\n' "$ARB_BLOCK" >> "$ZSHRC"
    log "Added Arborist block to .zshrc"
fi

# ── Done ──────────────────────────────────────────────────────────

echo ""
success "Installation complete!"
echo ""
echo "  Restart your shell or run 'source ~/.zshrc'."
echo "  Then run 'arb init' in a project directory to get started."
echo ""