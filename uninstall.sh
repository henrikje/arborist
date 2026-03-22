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

_arb_tmpfiles=()
trap 'rm -f "${_arb_tmpfiles[@]}"' EXIT
BIN_DIR="$HOME/.local/bin"
SHARE_DIR="$HOME/.local/share/arb"
ARB_MARKER="# Added by Arborist"

# ── Scan for installed artifacts ─────────────────────────────────

found_items=()

if [[ -f "$BIN_DIR/arb" ]]; then
    found_items+=("binary: $BIN_DIR/arb")
fi

SHELL_FILES=("$SHARE_DIR/arb.zsh" "$SHARE_DIR/arb.bash")
for shell_file in "${SHELL_FILES[@]}"; do
    if [[ -f "$shell_file" ]]; then
        found_items+=("shell file: $shell_file")
    fi
done

RC_FILES=("$HOME/.zshrc" "$HOME/.bash_profile" "$HOME/.bashrc")
rc_files_modified=()
for rc_file in "${RC_FILES[@]}"; do
    if [[ -f "$rc_file" ]] && grep -qF "$ARB_MARKER" "$rc_file"; then
        rc_files_modified+=("$rc_file")
        found_items+=("shell config: $rc_file")
    fi
done

if [[ ${#found_items[@]} -eq 0 ]]; then
    log "Nothing to uninstall. No arborist artifacts found in ~/.local/ or shell configs."
    exit 0
fi

# ── Show plan and confirm ────────────────────────────────────────

log "The following will be removed:"
echo ""
for item in "${found_items[@]}"; do
    log "  - $item"
done
echo ""

if [[ "${1:-}" == "--yes" || "${1:-}" == "-y" ]]; then
    :
else
    printf 'Continue? [y/N] '
    read -r answer
    case "$answer" in
        [yY]|[yY][eE][sS]) ;;
        *)
            log "Aborted."
            exit 0
            ;;
    esac
fi

# ── Remove RC modifications ─────────────────────────────────────

__arb_clean_rc() {
    local rc_file="$1" rc_name="$2"

    if [[ ! -f "$rc_file" ]] || ! grep -qF "$ARB_MARKER" "$rc_file"; then
        return
    fi

    # Positional removal: only strips lines immediately following the
    # marker that match our known content. User-added lines elsewhere
    # in the file that happen to contain the same text are left untouched.
    local tmp_file
    tmp_file="$(mktemp)"; _arb_tmpfiles+=("$tmp_file")

    awk -v marker="$ARB_MARKER" \
        -v path_line='export PATH="$HOME/.local/bin:$PATH"' \
        -v src_zsh='source "$HOME/.local/share/arb/arb.zsh"' \
        -v src_bash='source "$HOME/.local/share/arb/arb.bash"' \
        '
        $0 == marker { skip = 1; next }
        skip && ($0 == path_line || $0 == src_zsh || $0 == src_bash) { next }
        { skip = 0; print }
        ' "$rc_file" > "$tmp_file"

    cat "$tmp_file" > "$rc_file"
    rm -f "$tmp_file"

    log "Cleaned Arborist lines from $rc_name"
}

for rc_file in "${rc_files_modified[@]}"; do
    __arb_clean_rc "$rc_file" "~/$(basename "$rc_file")"
done

# ── Remove shell files ───────────────────────────────────────────

for shell_file in "${SHELL_FILES[@]}"; do
    if [[ -f "$shell_file" ]]; then
        rm -f "$shell_file"
        log "Removed $shell_file"
    fi
done

if [[ -d "$SHARE_DIR" ]] && [[ -z "$(ls -A "$SHARE_DIR")" ]]; then
    rmdir "$SHARE_DIR"
fi

if [[ -d "$HOME/.local/share" ]] && [[ -z "$(ls -A "$HOME/.local/share")" ]]; then
    rmdir "$HOME/.local/share"
fi

# ── Remove binary ────────────────────────────────────────────────

if [[ -f "$BIN_DIR/arb" ]]; then
    rm -f "$BIN_DIR/arb"
    log "Removed $BIN_DIR/arb"
fi

if [[ -d "$BIN_DIR" ]] && [[ -z "$(ls -A "$BIN_DIR")" ]]; then
    rmdir "$BIN_DIR"
fi

if [[ -d "$HOME/.local" ]] && [[ -z "$(ls -A "$HOME/.local")" ]]; then
    rmdir "$HOME/.local"
fi

# ── Post-uninstall guidance ──────────────────────────────────────

echo ""
success "Uninstall complete!"
echo ""

if command -v brew &>/dev/null && brew list --formula henrikje/tap/arb &>/dev/null 2>&1; then
    log "Homebrew version detected. Restart your shell to use it."
    case "$SHELL" in
        */zsh)
            log "Make sure your .zshrc sources the brew shell file:"
            log "  source \"\$(brew --prefix)/share/arb/arb.zsh\""
            ;;
        */bash)
            log "Make sure your shell profile sources the brew shell file:"
            log "  source \"\$(brew --prefix)/share/arb/arb.bash\""
            ;;
    esac
else
    log "No Homebrew installation detected."
    log "To install via Homebrew: brew install henrikje/tap/arb"
fi
echo ""
