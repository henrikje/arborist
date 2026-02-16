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

BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$HOME/.local/bin"
SHARE_DIR="$HOME/.local/share/arb"

# ── Pre-flight checks ────────────────────────────────────────────

IS_ZSH=false
if [[ "$SHELL" == */zsh ]] || command -v zsh &>/dev/null; then
    IS_ZSH=true
fi

# ── Build from source ────────────────────────────────────────────

if ! command -v bun &>/dev/null; then
    error "bun is not installed — cannot build from source"
    error "Install bun: https://bun.sh"
    exit 1
fi

log "Building from source..."
(cd "$BASE_DIR" && bun install && bun run build)

# ── Install binary ────────────────────────────────────────────────

mkdir -p "$BIN_DIR"

cp "$BASE_DIR/dist/arb" "$BIN_DIR/arb"
chmod +x "$BIN_DIR/arb"
log "Installed arb to $BIN_DIR/arb"

# ── Install shell function ────────────────────────────────────────

mkdir -p "$SHARE_DIR"
cp "$BASE_DIR/shell/arb.zsh" "$SHARE_DIR/arb.zsh"
log "Installed arb.zsh to $SHARE_DIR/arb.zsh"

# ── Configure shell ───────────────────────────────────────────────

if $IS_ZSH; then
    ZSHRC="$HOME/.zshrc"
    ARB_MARKER="# Added by Arborist"
    PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
    SOURCE_LINE='source "$HOME/.local/share/arb/arb.zsh"'
    OLD_SOURCE_LINE="source \"$BASE_DIR/shell/arb.zsh\""

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
fi

# ── Install Claude Code skill ────────────────────────────────────

CLAUDE_DIR="$HOME/.claude"
if [[ -d "$CLAUDE_DIR" ]]; then
    SKILL_DIR="$CLAUDE_DIR/skills/arb"
    mkdir -p "$SKILL_DIR/references"
    cp "$BASE_DIR/skill/SKILL.md" "$SKILL_DIR/SKILL.md"
    cp "$BASE_DIR/skill/references/commands.md" "$SKILL_DIR/references/commands.md"
    log "Installed Claude Code skill to $SKILL_DIR"
else
    log "Skipping Claude Code skill (no ~/.claude directory detected)"
fi

# ── Done ──────────────────────────────────────────────────────────

echo ""
success "Installation complete!"
echo ""
if $IS_ZSH; then
    echo "  Restart your shell or run 'source ~/.zshrc'."
else
    warn "zsh was not detected. Add the following to your shell profile manually:"
    echo ""
    case ":$PATH:" in
        *":$BIN_DIR:"*) ;;
        *) echo "  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
    esac
    echo "  source \"\$HOME/.local/share/arb/arb.zsh\""
    echo ""
    warn "Note: The shell function and tab completion require zsh."
fi
echo "  Then run 'arb init' in a project directory to get started."
echo ""