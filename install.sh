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

# ── Detect login shell ───────────────────────────────────────────

USER_SHELL=""
case "$SHELL" in
    */zsh)  USER_SHELL=zsh ;;
    */bash) USER_SHELL=bash ;;
esac

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

# ── Install shell files ──────────────────────────────────────────

mkdir -p "$SHARE_DIR"
cp "$BASE_DIR/shell/arb.zsh" "$SHARE_DIR/arb.zsh"
cp "$BASE_DIR/shell/arb.bash" "$SHARE_DIR/arb.bash"
log "Installed shell files to $SHARE_DIR/"

# ── Configure shell ───────────────────────────────────────────────

__arb_configure_rc() {
    local rc_file="$1" shell_file="$2" rc_name="$3"
    local ARB_MARKER="# Added by Arborist"
    local PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
    local SOURCE_LINE="source \"\$HOME/.local/share/arb/$shell_file\""
    local OLD_ZSH_SOURCE="source \"$BASE_DIR/shell/arb.zsh\""
    local OLD_BASH_SOURCE="source \"$BASE_DIR/shell/arb.bash\""

    # Remove old source lines pointing at repo checkout if present
    local old_line
    for old_line in "$OLD_ZSH_SOURCE" "$OLD_BASH_SOURCE"; do
        if [[ -f "$rc_file" ]] && grep -qF "$old_line" "$rc_file"; then
            sed -i '' "\|$old_line|d" "$rc_file" 2>/dev/null || \
                sed -i "\|$old_line|d" "$rc_file" 2>/dev/null || true
            log "Removed old source line from $rc_name"
        fi
    done

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
