arb() {
    # If the current directory has been deleted (e.g. after workspace removal),
    # recover to the nearest existing parent so subprocesses can start.
    if [[ ! -d "$PWD" ]]; then
        local _arb_recover="$PWD"
        while [[ -n "$_arb_recover" && ! -d "$_arb_recover" ]]; do
            _arb_recover="${_arb_recover%/*}"
        done
        cd "${_arb_recover:-/}" 2>/dev/null || cd "$HOME"
    fi

    if [[ "$1" == "cd" ]]; then
        # Pass help flags through without capturing
        case " ${*:2} " in
            *" --help "*|*" -h "*) command arb cd "${@:2}"; return ;;
        esac
        local _arb_dir
        _arb_dir="$(command arb cd "${@:2}")" || return
        cd "$_arb_dir"
        return
    fi

    if [[ "$1" == "create" ]]; then
        # Pass help flags through without capturing
        case " ${*:2} " in
            *" --help "*|*" -h "*) command arb create "${@:2}"; return ;;
        esac
        local _arb_dir
        _arb_dir="$(command arb create "${@:2}")" || return
        [[ -n "$_arb_dir" ]] && cd "$_arb_dir"
        return
    fi

    command arb "$@"
}

# ── Completion helpers ───────────────────────────────────────────

__arb_find_base_dir() {
    local dir="$PWD"
    # If cwd has been deleted, walk up to the nearest existing parent first
    while [[ -n "$dir" && "$dir" != "/" && ! -d "$dir" ]]; do
        dir="${dir%/*}"
    done
    while [[ -n "$dir" && "$dir" != "/" ]]; do
        if [[ -d "$dir/.arb" ]]; then
            printf '%s' "$dir"
            return
        fi
        dir="${dir%/*}"
    done
}

__arb_workspace_names() {
    local base_dir="$1"
    [[ -z "$base_dir" ]] && return
    local d
    for d in "$base_dir"/*/; do
        [[ -d "${d}.arbws" ]] && printf '%s\n' "${d%/}"
    done | while IFS= read -r p; do printf '%s\n' "${p##*/}"; done
}

__arb_repo_names() {
    local base_dir="$1"
    [[ -z "$base_dir" || ! -d "$base_dir/.arb/repos" ]] && return
    local d
    for d in "$base_dir/.arb/repos"/*/; do
        [[ -d "$d" ]] && printf '%s\n' "${d%/}"
    done | while IFS= read -r p; do printf '%s\n' "${p##*/}"; done
}

__arb_where_filters() {
    printf '%s\n' dirty unpushed behind-remote behind-base drifted detached operation local gone shallow at-risk
}

__arb_template_names() {
    local base_dir="$1"
    [[ -z "$base_dir" ]] && return

    local tpl_dir f rel
    local -a names=()

    # Workspace-scoped templates
    tpl_dir="$base_dir/.arb/templates/workspace"
    if [[ -d "$tpl_dir" ]]; then
        while IFS= read -r f; do
            rel="${f#"$tpl_dir"/}"
            [[ "$rel" == *.arbtemplate ]] && rel="${rel%.arbtemplate}"
            names+=("$rel")
        done < <(find "$tpl_dir" -type f 2>/dev/null)
    fi

    # Repo-scoped templates
    tpl_dir="$base_dir/.arb/templates/repos"
    if [[ -d "$tpl_dir" ]]; then
        while IFS= read -r f; do
            rel="${f#"$tpl_dir"/}"
            rel="${rel#*/}"
            [[ "$rel" == *.arbtemplate ]] && rel="${rel%.arbtemplate}"
            names+=("$rel")
        done < <(find "$tpl_dir" -mindepth 2 -type f 2>/dev/null)
    fi

    # Deduplicate
    printf '%s\n' "${names[@]}" | sort -u
}

# ── Where filter completion (comma-separated) ───────────────────

__arb_complete_where_value() {
    local cur="$1"
    local prefix=""
    if [[ "$cur" == *,* ]]; then
        prefix="${cur%,*},"
        cur="${cur##*,}"
    fi
    local filter
    while IFS= read -r filter; do
        if [[ "$filter" == "$cur"* ]]; then
            COMPREPLY+=("${prefix}${filter}")
        fi
    done < <(__arb_where_filters)
    # Suppress trailing space so user can add more comma-separated values
    type compopt &>/dev/null && compopt -o nospace
}

# ── Per-subcommand completions ───────────────────────────────────

__arb_complete_init() {
    COMPREPLY=($(compgen -d -- "$1"))
}

__arb_complete_repo() {
    local base_dir="$1" cur="$2"
    local prev="${COMP_WORDS[COMP_CWORD-1]}"
    local sub_pos=0 i

    # Find the repo subcommand position (skip "repo" itself)
    for ((i=0; i<${#COMP_WORDS[@]}; i++)); do
        if [[ "${COMP_WORDS[i]}" == "repo" ]]; then
            sub_pos=$((i+1))
            break
        fi
    done

    if ((COMP_CWORD == sub_pos)); then
        COMPREPLY=($(compgen -W "clone list" -- "$cur"))
        return
    fi

    local sub="${COMP_WORDS[sub_pos]}"
    case "$sub" in
        clone)
            if [[ "$prev" == "--upstream" ]]; then
                return  # URL, no completion
            fi
            COMPREPLY=($(compgen -W "--upstream" -- "$cur"))
            ;;
        list) ;;
    esac
}

__arb_complete_create() {
    local base_dir="$1" cur="$2"
    if [[ "$cur" == -* ]]; then
        COMPREPLY=($(compgen -W "-b --branch --base -a --all-repos" -- "$cur"))
        return
    fi
    local prev="${COMP_WORDS[COMP_CWORD-1]}"
    if [[ "$prev" == "-b" || "$prev" == "--branch" || "$prev" == "--base" ]]; then
        return  # branch name, no completion
    fi
    # Complete repo names
    COMPREPLY=($(compgen -W "$(__arb_repo_names "$base_dir")" -- "$cur"))
}

__arb_complete_remove() {
    local base_dir="$1" cur="$2"
    local prev="${COMP_WORDS[COMP_CWORD-1]}"
    if [[ "$prev" == "-w" || "$prev" == "--where" ]]; then
        __arb_complete_where_value "$cur"
        return
    fi
    if [[ "$cur" == -* ]]; then
        COMPREPLY=($(compgen -W "-f --force -d --delete-remote -y --yes -a --all-safe -w --where -n --dry-run" -- "$cur"))
        return
    fi
    COMPREPLY=($(compgen -W "$(__arb_workspace_names "$base_dir")" -- "$cur"))
}

__arb_complete_list() {
    local cur="$1"
    local prev="${COMP_WORDS[COMP_CWORD-1]}"
    if [[ "$prev" == "-w" || "$prev" == "--where" ]]; then
        __arb_complete_where_value "$cur"
        return
    fi
    COMPREPLY=($(compgen -W "-f --fetch -q --quick -w --where --json" -- "$cur"))
}

__arb_complete_path() {
    local base_dir="$1" cur="$2"
    COMPREPLY=($(compgen -W "$(__arb_workspace_names "$base_dir")" -- "$cur"))
}

__arb_complete_cd() {
    local base_dir="$1" cur="$2"
    if [[ "$cur" == */* ]]; then
        # After slash: complete worktree names within the workspace
        local ws_name="${cur%%/*}"
        local ws_dir="$base_dir/$ws_name"
        if [[ -d "$ws_dir" ]]; then
            local -a wt_names=()
            local d
            for d in "$ws_dir"/*/; do
                [[ -d "$d" ]] || continue
                local name="${d%/}"
                name="${name##*/}"
                [[ "$name" == ".arbws" ]] && continue
                wt_names+=("$ws_name/$name")
            done
            COMPREPLY=($(compgen -W "${wt_names[*]}" -- "$cur"))
        fi
    else
        # Before slash: complete workspace names, append /
        local -a ws=()
        local w
        while IFS= read -r w; do
            [[ -n "$w" ]] && ws+=("$w/")
        done < <(__arb_workspace_names "$base_dir")
        COMPREPLY=($(compgen -W "${ws[*]}" -- "$cur"))
        # Suppress trailing space so user can continue with repo name
        type compopt &>/dev/null && compopt -o nospace
    fi
}

__arb_complete_add() {
    local base_dir="$1" cur="$2"
    if [[ "$cur" == -* ]]; then
        COMPREPLY=($(compgen -W "-a --all-repos" -- "$cur"))
        return
    fi
    COMPREPLY=($(compgen -W "$(__arb_repo_names "$base_dir")" -- "$cur"))
}

__arb_complete_drop() {
    local base_dir="$1" cur="$2"
    if [[ "$cur" == -* ]]; then
        COMPREPLY=($(compgen -W "-f --force -a --all-repos --delete-branch" -- "$cur"))
        return
    fi
    COMPREPLY=($(compgen -W "$(__arb_repo_names "$base_dir")" -- "$cur"))
}

__arb_complete_status() {
    local cur="$1"
    local prev="${COMP_WORDS[COMP_CWORD-1]}"
    if [[ "$prev" == "-w" || "$prev" == "--where" ]]; then
        __arb_complete_where_value "$cur"
        return
    fi
    COMPREPLY=($(compgen -W "-d --dirty -w --where -f --fetch -v --verbose --json" -- "$cur"))
}

__arb_complete_fetch() {
    return  # No flags or arguments
}

__arb_complete_pull() {
    local base_dir="$1" cur="$2"
    if [[ "$cur" == -* ]]; then
        COMPREPLY=($(compgen -W "-y --yes -n --dry-run --rebase --merge" -- "$cur"))
        return
    fi
    COMPREPLY=($(compgen -W "$(__arb_repo_names "$base_dir")" -- "$cur"))
}

__arb_complete_push() {
    local base_dir="$1" cur="$2"
    if [[ "$cur" == -* ]]; then
        COMPREPLY=($(compgen -W "-f --force --no-fetch -y --yes -n --dry-run" -- "$cur"))
        return
    fi
    COMPREPLY=($(compgen -W "$(__arb_repo_names "$base_dir")" -- "$cur"))
}

__arb_complete_rebase() {
    local base_dir="$1" cur="$2"
    if [[ "$cur" == -* ]]; then
        COMPREPLY=($(compgen -W "-F --no-fetch -y --yes -n --dry-run" -- "$cur"))
        return
    fi
    COMPREPLY=($(compgen -W "$(__arb_repo_names "$base_dir")" -- "$cur"))
}

__arb_complete_merge() {
    local base_dir="$1" cur="$2"
    if [[ "$cur" == -* ]]; then
        COMPREPLY=($(compgen -W "-F --no-fetch -y --yes -n --dry-run" -- "$cur"))
        return
    fi
    COMPREPLY=($(compgen -W "$(__arb_repo_names "$base_dir")" -- "$cur"))
}

__arb_complete_exec() {
    local base_dir="$1" cur="$2"
    local prev="${COMP_WORDS[COMP_CWORD-1]}"
    if [[ "$prev" == "--repo" ]]; then
        COMPREPLY=($(compgen -W "$(__arb_repo_names "$base_dir")" -- "$cur"))
        return
    fi
    if [[ "$prev" == "-w" || "$prev" == "--where" ]]; then
        __arb_complete_where_value "$cur"
        return
    fi
    if [[ "$cur" == -* ]]; then
        COMPREPLY=($(compgen -W "--repo -d --dirty -w --where" -- "$cur"))
        return
    fi
}

__arb_complete_open() {
    local base_dir="$1" cur="$2"
    local prev="${COMP_WORDS[COMP_CWORD-1]}"
    if [[ "$prev" == "--repo" ]]; then
        COMPREPLY=($(compgen -W "$(__arb_repo_names "$base_dir")" -- "$cur"))
        return
    fi
    if [[ "$prev" == "-w" || "$prev" == "--where" ]]; then
        __arb_complete_where_value "$cur"
        return
    fi
    if [[ "$cur" == -* ]]; then
        COMPREPLY=($(compgen -W "--repo -d --dirty -w --where" -- "$cur"))
        return
    fi
    # Editor names
    COMPREPLY=($(compgen -W "code cursor zed subl" -- "$cur"))
}

__arb_complete_template() {
    local base_dir="$1" cur="$2"
    local prev="${COMP_WORDS[COMP_CWORD-1]}"
    local sub_pos=0 i

    # Find the template subcommand position
    for ((i=0; i<${#COMP_WORDS[@]}; i++)); do
        if [[ "${COMP_WORDS[i]}" == "template" ]]; then
            sub_pos=$((i+1))
            break
        fi
    done

    if ((COMP_CWORD == sub_pos)); then
        COMPREPLY=($(compgen -W "add remove list diff apply" -- "$cur"))
        return
    fi

    local sub="${COMP_WORDS[sub_pos]}"
    case "$sub" in
        add)
            if [[ "$prev" == "--repo" ]]; then
                COMPREPLY=($(compgen -W "$(__arb_repo_names "$base_dir")" -- "$cur"))
                return
            fi
            if [[ "$cur" == -* ]]; then
                COMPREPLY=($(compgen -W "--repo --workspace -f --force" -- "$cur"))
                return
            fi
            COMPREPLY=($(compgen -f -- "$cur"))
            ;;
        remove)
            if [[ "$prev" == "--repo" ]]; then
                COMPREPLY=($(compgen -W "$(__arb_repo_names "$base_dir")" -- "$cur"))
                return
            fi
            if [[ "$cur" == -* ]]; then
                COMPREPLY=($(compgen -W "--repo --workspace" -- "$cur"))
                return
            fi
            COMPREPLY=($(compgen -W "$(__arb_template_names "$base_dir")" -- "$cur"))
            ;;
        list) ;;
        diff)
            if [[ "$prev" == "--repo" ]]; then
                COMPREPLY=($(compgen -W "$(__arb_repo_names "$base_dir")" -- "$cur"))
                return
            fi
            if [[ "$cur" == -* ]]; then
                COMPREPLY=($(compgen -W "--repo --workspace" -- "$cur"))
                return
            fi
            COMPREPLY=($(compgen -W "$(__arb_template_names "$base_dir")" -- "$cur"))
            ;;
        apply)
            if [[ "$prev" == "--repo" ]]; then
                COMPREPLY=($(compgen -W "$(__arb_repo_names "$base_dir")" -- "$cur"))
                return
            fi
            if [[ "$cur" == -* ]]; then
                COMPREPLY=($(compgen -W "--repo --workspace -f --force" -- "$cur"))
                return
            fi
            COMPREPLY=($(compgen -W "$(__arb_template_names "$base_dir")" -- "$cur"))
            ;;
    esac
}

# ── Main completion function ─────────────────────────────────────

_arb() {
    local cur="${COMP_WORDS[COMP_CWORD]}"
    COMPREPLY=()

    local base_dir
    base_dir="$(__arb_find_base_dir)"

    # Find the subcommand position, skipping global flags (-C <dir>, -h, --help, -v, --version)
    local cmd_pos=1
    while ((cmd_pos < COMP_CWORD)); do
        case "${COMP_WORDS[cmd_pos]}" in
            -C)  ((cmd_pos += 2)) ;;   # -C takes a directory argument
            -h|--help|-v|--version) ((cmd_pos++)) ;;
            -*) ((cmd_pos++)) ;;
            *)  break ;;
        esac
    done

    # Completing the subcommand itself
    if ((COMP_CWORD <= cmd_pos)); then
        local commands="init repo create remove list path cd add drop status fetch pull push rebase merge exec open template help"
        # Also complete global flags
        if [[ "$cur" == -* ]]; then
            COMPREPLY=($(compgen -W "-C -h --help -v --version" -- "$cur"))
            return
        fi
        COMPREPLY=($(compgen -W "$commands" -- "$cur"))
        return
    fi

    # Dispatch to per-subcommand completion
    local subcmd="${COMP_WORDS[cmd_pos]}"
    case "$subcmd" in
        init)     __arb_complete_init "$cur" ;;
        repo)     __arb_complete_repo "$base_dir" "$cur" ;;
        create)   __arb_complete_create "$base_dir" "$cur" ;;
        remove)   __arb_complete_remove "$base_dir" "$cur" ;;
        list)     __arb_complete_list "$cur" ;;
        path)     __arb_complete_path "$base_dir" "$cur" ;;
        cd)       __arb_complete_cd "$base_dir" "$cur" ;;
        add)      __arb_complete_add "$base_dir" "$cur" ;;
        drop)     __arb_complete_drop "$base_dir" "$cur" ;;
        status)   __arb_complete_status "$cur" ;;
        fetch)    __arb_complete_fetch ;;
        pull)     __arb_complete_pull "$base_dir" "$cur" ;;
        push)     __arb_complete_push "$base_dir" "$cur" ;;
        rebase)   __arb_complete_rebase "$base_dir" "$cur" ;;
        merge)    __arb_complete_merge "$base_dir" "$cur" ;;
        exec)     __arb_complete_exec "$base_dir" "$cur" ;;
        open)     __arb_complete_open "$base_dir" "$cur" ;;
        template) __arb_complete_template "$base_dir" "$cur" ;;
    esac
}

complete -F _arb arb
