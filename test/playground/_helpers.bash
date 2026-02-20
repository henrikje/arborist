#!/usr/bin/env bash
# Shared primitives for playground setup scripts.
# Source this file — do not execute it directly.

# ── Output helpers ────────────────────────────────────────────────

if [[ -z "${NO_COLOR:-}" ]]; then
    _bold='\033[1m'
    _dim='\033[2m'
    _green='\033[32m'
    _cyan='\033[36m'
    _yellow='\033[33m'
    _reset='\033[0m'
else
    _bold='' _dim='' _green='' _cyan='' _yellow='' _reset=''
fi

header() { printf "\n${_bold}${_green}==> %s${_reset}\n" "$*" >&2; }
step()   { printf "  ${_cyan}•${_reset} %s\n" "$*" >&2; }
hint()   { printf "  ${_dim}%s${_reset}\n" "$*" >&2; }

# ── Git config for temp clones ────────────────────────────────────

_git_cfg=(-c user.name=Demo -c user.email=demo@example.com)

# ── Playground init ───────────────────────────────────────────────

# init_playground <dir>
#   Removes existing dir if present, creates fresh directory.
#   Sets PLAYGROUND_DIR and ORIGINS_DIR.
init_playground() {
    PLAYGROUND_DIR="$1"
    ORIGINS_DIR="$PLAYGROUND_DIR/.origins"

    if [[ -d "$PLAYGROUND_DIR" ]]; then
        step "Removing existing $PLAYGROUND_DIR"
        rm -rf "$PLAYGROUND_DIR"
    fi

    mkdir -p "$PLAYGROUND_DIR" "$ORIGINS_DIR"
}

# ── Bare repo creation ────────────────────────────────────────────

# create_origin_repo <name> <file:content>...
#   Creates a bare git repo at $ORIGINS_DIR/<name>.git with initial files.
#   Each argument after the name is "filepath:content" to populate.
create_origin_repo() {
    local name="$1"; shift
    local bare_dir="$ORIGINS_DIR/${name}.git"
    local tmp_clone="$ORIGINS_DIR/.tmp-${name}"

    git init --bare "$bare_dir" -b main >/dev/null 2>&1
    git clone "$bare_dir" "$tmp_clone" >/dev/null 2>&1

    for spec in "$@"; do
        local filepath="${spec%%:*}"
        local content="${spec#*:}"
        mkdir -p "$tmp_clone/$(dirname "$filepath")"
        printf '%s' "$content" > "$tmp_clone/$filepath"
        git -C "$tmp_clone" add "$filepath" >/dev/null 2>&1
    done

    git "${_git_cfg[@]}" -C "$tmp_clone" commit -m "Initial commit" >/dev/null 2>&1
    git -C "$tmp_clone" push >/dev/null 2>&1
    rm -rf "$tmp_clone"
}

# ── Add commits on a branch ──────────────────────────────────────

# add_commits_on_branch <repo> <branch> <base> <file:content>...
#   Clones the bare repo, creates branch from base, adds files, pushes.
add_commits_on_branch() {
    local repo="$1" branch="$2" base="$3"; shift 3
    local bare_dir="$ORIGINS_DIR/${repo}.git"
    local tmp_clone="$ORIGINS_DIR/.tmp-${repo}-${branch}"

    git clone "$bare_dir" "$tmp_clone" >/dev/null 2>&1
    git -C "$tmp_clone" checkout -b "$branch" "origin/$base" >/dev/null 2>&1

    local msg=""
    for spec in "$@"; do
        local filepath="${spec%%:*}"
        local content="${spec#*:}"
        mkdir -p "$tmp_clone/$(dirname "$filepath")"
        printf '%s' "$content" > "$tmp_clone/$filepath"
        git -C "$tmp_clone" add "$filepath" >/dev/null 2>&1
        msg="Add $filepath"
    done

    git "${_git_cfg[@]}" -C "$tmp_clone" commit -m "${msg:-Update files}" >/dev/null 2>&1
    git -C "$tmp_clone" push -u origin "$branch" >/dev/null 2>&1
    rm -rf "$tmp_clone"
}

# ── Simulate merge ───────────────────────────────────────────────

# simulate_merge <repo> <source> <target> [squash] [delete]
#   Clones bare repo, merges source into target, pushes.
#   Pass "squash" as 4th arg for squash merge.
#   Pass "delete" as 4th or 5th arg to delete source branch on remote.
simulate_merge() {
    local repo="$1" source="$2" target="$3"
    local squash="${4:-}"
    local delete="${5:-${4:-}}"
    local bare_dir="$ORIGINS_DIR/${repo}.git"
    local tmp_clone="$ORIGINS_DIR/.tmp-merge-${repo}"

    git clone "$bare_dir" "$tmp_clone" >/dev/null 2>&1
    git -C "$tmp_clone" checkout "$target" >/dev/null 2>&1

    if [[ "$squash" == "squash" ]]; then
        git -C "$tmp_clone" merge --squash "origin/$source" >/dev/null 2>&1
        git "${_git_cfg[@]}" -C "$tmp_clone" commit -m "Squash merge $source" >/dev/null 2>&1
    else
        git "${_git_cfg[@]}" -C "$tmp_clone" merge "origin/$source" --no-ff -m "Merge $source" >/dev/null 2>&1
    fi

    git -C "$tmp_clone" push >/dev/null 2>&1

    if [[ "$delete" == "delete" ]]; then
        git -C "$bare_dir" branch -D "$source" >/dev/null 2>&1
    fi

    rm -rf "$tmp_clone"
}

# ── Precondition check ───────────────────────────────────────────

require_arb() {
    if ! command -v arb &>/dev/null; then
        printf "${_bold}Error:${_reset} 'arb' not found on PATH.\n" >&2
        printf "Install it first: https://github.com/henrikje/arborist\n" >&2
        exit 1
    fi
}
