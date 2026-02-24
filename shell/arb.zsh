arb() {
    # If the current directory has been deleted (e.g. after workspace removal),
    # recover to the nearest existing parent so subprocesses can start.
    if [[ ! -d "$PWD" ]]; then
        local _arb_recover="$PWD"
        while [[ -n "$_arb_recover" && ! -d "$_arb_recover" ]]; do
            _arb_recover="${_arb_recover:h}"
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

_arb_where_filter() {
    local -a all_terms=(
        dirty unpushed behind-share behind-base diverged drifted detached
        operation gone shallow merged base-merged base-missing at-risk stale
    )
    # Parse already-entered terms (split on , and +) to offer remaining ones
    local input="${PREFIX}${SUFFIX}"
    local -a used=()
    if [[ "$input" == *[,+]* ]]; then
        local prefix="${input%[,+]*}"
        used=("${(@s:,:)prefix}")
        local -a expanded=()
        for u in "${used[@]}"; do
            expanded+=("${(@s:+:)u}")
        done
        used=("${expanded[@]}")
    fi
    local -a remaining=()
    for t in "${all_terms[@]}"; do
        if (( ! ${used[(Ie)$t]} )); then
            remaining+=("$t")
        fi
    done
    # Set up prefix for completion after the last separator
    if [[ "$input" == *[,+]* ]]; then
        compset -P "*[,+]"
    fi
    compadd -S '' -a remaining
}

_arb_template_names() {
    local base_dir="$1"
    [[ -z "$base_dir" ]] && return

    local -a names=()
    local f tpl_dir

    # Workspace-scoped templates
    tpl_dir="$base_dir/.arb/templates/workspace"
    if [[ -d "$tpl_dir" ]]; then
        for f in "$tpl_dir"/**/*(N.); do
            local rel="${f#$tpl_dir/}"
            [[ "$rel" == *.arbtemplate ]] && rel="${rel%.arbtemplate}"
            names+=("$rel")
        done
    fi

    # Repo-scoped templates
    tpl_dir="$base_dir/.arb/templates/repos"
    if [[ -d "$tpl_dir" ]]; then
        for f in "$tpl_dir"/*/**/*(N.); do
            # Strip repos/<repo>/ prefix to get the relative path
            local rel="${f#$tpl_dir/}"
            rel="${rel#*/}"
            [[ "$rel" == *.arbtemplate ]] && rel="${rel%.arbtemplate}"
            names+=("$rel")
        done
    fi

    # Deduplicate and offer completions
    local -aU unique_names=(${names[@]})
    compadd -a unique_names
}

_arb() {
    # Walk up from $PWD looking for .arb/ marker
    local base_dir=""
    local dir="$PWD"
    # If cwd has been deleted, walk up to the nearest existing parent first
    while [[ -n "$dir" && "$dir" != "/" && ! -d "$dir" ]]; do
        dir="${dir:h}"
    done
    while [[ "$dir" != "/" ]]; do
        if [[ -d "$dir/.arb" ]]; then
            base_dir="$dir"
            break
        fi
        dir="${dir:h}"
    done

    local -a ws_names=()
    local -a repo_names=()
    if [[ -n "$base_dir" ]]; then
        ws_names=(${base_dir}/*/.arbws(N:h:t))
        [[ -d "$base_dir/.arb/repos" ]] && repo_names=("$base_dir/.arb/repos"/*(N/:t))
    fi

    _arguments -C \
        '-C[Run as if arb was started in <directory>]:directory:_directories' \
        '(-h --help)'{-h,--help}'[Show help]' \
        '(-v --version)'{-v,--version}'[Show version]' \
        '1:command:->command' \
        '*::arg:->args'

    case "$state" in
        command)
            local -a subcommands=(
                'init:Initialize a directory as an arb root'
                'repo:Manage canonical repos'
                'create:Create a new workspace'
                'delete:Remove a workspace'
                'clean:Clean up non-workspace directories and stale git state'
                'list:List all workspaces'
                'path:Print the path to the arb root or a workspace'
                'cd:Navigate to a workspace directory'
                'attach:Attach repos to the workspace'
                'detach:Detach repos from the workspace'
                'status:Show workspace status'
                'pull:Pull the feature branch from the share remote'
                'push:Push the feature branch to the share remote'
                'rebase:Rebase feature branches onto the base branch'
                'merge:Merge the base branch into feature branches'
                'rebranch:Rename the workspace branch across all repos'
                'log:Show feature branch commits across repos'
                'diff:Show feature branch diff across repos'
                'exec:Run a command in each worktree'
                'open:Open worktrees in an application'
                'template:Manage workspace templates'
                'help:Show help'
            )
            _describe 'command' subcommands
            ;;
        args)
            case "${words[1]}" in
                delete)
                    _arguments \
                        '*:workspace:($ws_names)' \
                        '(-f --force)'{-f,--force}'[Force removal]' \
                        '(-r --delete-remote)'{-r,--delete-remote}'[Delete remote branches]' \
                        '(-d --dirty -w --where)'{-d,--dirty}'[Only target dirty workspaces]' \
                        '(-y --yes)'{-y,--yes}'[Skip confirmation prompt]' \
                        '(-a --all-safe)'{-a,--all-safe}'[Remove all safe workspaces]' \
                        '(-d --dirty -w --where)'{-w,--where}'[Filter workspaces by status flags]:filter:_arb_where_filter' \
                        '(-n --dry-run)'{-n,--dry-run}'[Show what would happen without executing]'
                    ;;
                clean)
                    # Complete non-workspace directory names
                    local -a non_ws_names=()
                    if [[ -n "$base_dir" ]]; then
                        for d in "$base_dir"/*(N/); do
                            local name="${d:t}"
                            [[ "$name" == .* ]] && continue
                            [[ -d "$d/.arbws" ]] && continue
                            non_ws_names+=("$name")
                        done
                    fi
                    _arguments \
                        '*:directory:($non_ws_names)' \
                        '(-y --yes)'{-y,--yes}'[Skip confirmation prompt]' \
                        '(-n --dry-run)'{-n,--dry-run}'[Show what would happen without executing]'
                    ;;
                path)
                    # Detect if we're inside a workspace
                    local _arb_ws=""
                    if [[ -n "$base_dir" && "$PWD" == "$base_dir/"* ]]; then
                        local _arb_rest="${PWD#$base_dir/}"
                        local _arb_first="${_arb_rest%%/*}"
                        [[ -n "$_arb_first" && -d "$base_dir/$_arb_first/.arbws" ]] && _arb_ws="$_arb_first"
                    fi
                    if [[ -n "$_arb_ws" ]]; then
                        local -a wt_names=(${base_dir}/${_arb_ws}/*(N/:t))
                        wt_names=(${wt_names:#.arbws})
                        # Filter to dirs with .git
                        local -a git_wt=()
                        for _n in $wt_names; do
                            [[ -e "$base_dir/$_arb_ws/$_n/.git" ]] && git_wt+=("$_n")
                        done
                        compadd -a git_wt
                        compadd -S '/' -a ws_names
                    else
                        _arguments '1:workspace:($ws_names)'
                    fi
                    ;;
                cd)
                    local input="${words[2]:-}"
                    if [[ "$input" == */* ]]; then
                        # After slash: complete worktree names within the workspace
                        local ws_name="${input%%/*}"
                        local ws_dir="$base_dir/$ws_name"
                        if [[ -d "$ws_dir" ]]; then
                            local -a wt_names=(${ws_dir}/*(N/:t))
                            wt_names=(${wt_names:#.arbws})
                            compadd -p "$ws_name/" -a wt_names
                        fi
                    else
                        # Detect if we're inside a workspace
                        local _arb_ws=""
                        if [[ -n "$base_dir" && "$PWD" == "$base_dir/"* ]]; then
                            local _arb_rest="${PWD#$base_dir/}"
                            local _arb_first="${_arb_rest%%/*}"
                            [[ -n "$_arb_first" && -d "$base_dir/$_arb_first/.arbws" ]] && _arb_ws="$_arb_first"
                        fi
                        if [[ -n "$_arb_ws" ]]; then
                            # Inside a workspace: offer worktree names + workspace names with /
                            local -a wt_names=(${base_dir}/${_arb_ws}/*(N/:t))
                            wt_names=(${wt_names:#.arbws})
                            local -a git_wt=()
                            for _n in $wt_names; do
                                [[ -e "$base_dir/$_arb_ws/$_n/.git" ]] && git_wt+=("$_n")
                            done
                            compadd -a git_wt
                            compadd -S '/' -a ws_names
                        else
                            # Before slash: complete workspace names
                            _arguments '1:workspace:($ws_names)'
                        fi
                    fi
                    ;;
                create)
                    _arguments \
                        '(-b --branch)'{-b,--branch}'[Branch name]:branch:' \
                        '--base[Base branch to branch from]:branch:' \
                        '(-a --all-repos)'{-a,--all-repos}'[Include all repos in this root]' \
                        '1:name:' \
                        '*:repo:($repo_names)'
                    ;;
                attach)
                    _arguments \
                        '(-a --all-repos)'{-a,--all-repos}'[Add all remaining repos]' \
                        '*:repo:($repo_names)'
                    ;;
                detach)
                    _arguments \
                        '(-f --force)'{-f,--force}'[Force removal even with uncommitted changes]' \
                        '(-a --all-repos)'{-a,--all-repos}'[Drop all repos from the workspace]' \
                        '--delete-branch[Delete the local branch from the canonical repo]' \
                        '*:repo:($repo_names)'
                    ;;
                repo)
                    shift words; (( CURRENT-- ))
                    if (( CURRENT == 1 )); then
                        local -a repo_subcmds=(
                            'clone:Clone a repo into .arb/repos/'
                            'list:List cloned repos'
                            'remove:Remove canonical repos from .arb/repos/'
                        )
                        _describe 'repo command' repo_subcmds
                    else
                        case "${words[1]}" in
                            clone)
                                shift words; (( CURRENT-- ))
                                _arguments \
                                    '--upstream[Add an upstream remote (for fork workflows)]:url:' \
                                    '1:url:' \
                                    '2:name:'
                                ;;
                            remove)
                                shift words; (( CURRENT-- ))
                                _arguments \
                                    '(-a --all-repos)'{-a,--all-repos}'[Remove all canonical repos]' \
                                    '(-y --yes)'{-y,--yes}'[Skip confirmation prompt]' \
                                    '*:repo:($repo_names)'
                                ;;
                            list)
                                shift words; (( CURRENT-- ))
                                _arguments \
                                    '(-q --quiet --json -v --verbose)'{-q,--quiet}'[Output one repo name per line]' \
                                    '(-v --verbose -q --quiet --json)'{-v,--verbose}'[Show remote URLs alongside names]' \
                                    '(--json -q --quiet -v --verbose)--json[Output structured JSON]'
                                ;;
                        esac
                    fi
                    ;;
                init)
                    _arguments '1:path:_directories'
                    ;;
                list)
                    _arguments \
                        '(-F --fetch)'{-F,--fetch}'[Fetch all repos before listing]' \
                        '--no-status[Skip per-repo status (faster for large setups)]' \
                        '(-q --quiet --json)'{-q,--quiet}'[Output one workspace name per line]' \
                        '(-d --dirty -w --where)'{-d,--dirty}'[Only list dirty workspaces]' \
                        '(-d --dirty -w --where)'{-w,--where}'[Filter workspaces by status flags]:filter:_arb_where_filter' \
                        '(--json -q --quiet)--json[Output structured JSON]'
                    ;;
                status)
                    _arguments \
                        '(-d --dirty -w --where)'{-d,--dirty}'[Only show dirty repos]' \
                        '(-d --dirty -w --where)'{-w,--where}'[Filter repos by status flags]:filter:_arb_where_filter' \
                        '(-F --fetch --no-fetch)'{-F,--fetch}'[Fetch before showing status]' \
                        '(-F --fetch --no-fetch)--no-fetch[Skip fetching (default)]' \
                        '(-v --verbose -q --quiet)'{-v,--verbose}'[Show file-level detail]' \
                        '(-q --quiet --json -v --verbose)'{-q,--quiet}'[Output one repo name per line]' \
                        '(--json -q --quiet)--json[Output structured JSON]'
                    ;;
                exec)
                    _arguments \
                        '*--repo[Only run in specified repos]:repo:($repo_names)' \
                        '(-d --dirty -w --where)'{-d,--dirty}'[Only run in dirty repos]' \
                        '(-d --dirty -w --where)'{-w,--where}'[Filter repos by status flags]:filter:_arb_where_filter' \
                        '*:command:'
                    ;;
                open)
                    _arguments \
                        '*--repo[Only open specified repos]:repo:($repo_names)' \
                        '(-d --dirty -w --where)'{-d,--dirty}'[Only open dirty worktrees]' \
                        '(-d --dirty -w --where)'{-w,--where}'[Filter worktrees by status flags]:filter:_arb_where_filter' \
                        '1:editor:(code cursor zed subl)'
                    ;;
                pull)
                    _arguments \
                        '(-y --yes)'{-y,--yes}'[Skip confirmation prompt]' \
                        '(-n --dry-run)'{-n,--dry-run}'[Show what would happen without executing]' \
                        '(--merge)--rebase[Pull with rebase]' \
                        '(--rebase)--merge[Pull with merge]' \
                        '--autostash[Stash uncommitted changes before pull, re-apply after]' \
                        '*:repo:($repo_names)'
                    ;;
                push)
                    _arguments \
                        '(-f --force)'{-f,--force}'[Force push with lease]' \
                        '(-F --fetch --no-fetch)'{-F,--fetch}'[Fetch before push (default)]' \
                        '(-F --fetch --no-fetch)--no-fetch[Skip fetching before push]' \
                        '(-y --yes)'{-y,--yes}'[Skip confirmation prompt]' \
                        '(-n --dry-run)'{-n,--dry-run}'[Show what would happen without executing]' \
                        '*:repo:($repo_names)'
                    ;;
                rebase)
                    _arguments \
                        '(-F --fetch --no-fetch)'{-F,--fetch}'[Fetch before rebase (default)]' \
                        '(-F --fetch --no-fetch)--no-fetch[Skip fetching before rebase]' \
                        '(-y --yes)'{-y,--yes}'[Skip confirmation prompt]' \
                        '(-n --dry-run)'{-n,--dry-run}'[Show what would happen without executing]' \
                        '--retarget=-[Retarget repos whose base has been merged; optionally specify branch]::branch:' \
                        '--autostash[Stash uncommitted changes before rebase, re-apply after]' \
                        '*:repo:($repo_names)'
                    ;;
                merge)
                    _arguments \
                        '(-F --fetch --no-fetch)'{-F,--fetch}'[Fetch before merge (default)]' \
                        '(-F --fetch --no-fetch)--no-fetch[Skip fetching before merge]' \
                        '(-y --yes)'{-y,--yes}'[Skip confirmation prompt]' \
                        '(-n --dry-run)'{-n,--dry-run}'[Show what would happen without executing]' \
                        '--autostash[Stash uncommitted changes before merge, re-apply after]' \
                        '*:repo:($repo_names)'
                    ;;
                rebranch)
                    _arguments \
                        '--continue[Resume an in-progress rebranch]' \
                        '--abort[Roll back an in-progress rebranch]' \
                        '--delete-remote-old[Delete old branch on remote after rename]' \
                        '(-F --fetch --no-fetch)'{-F,--fetch}'[Fetch before rebranch (default)]' \
                        '(-F --fetch --no-fetch)--no-fetch[Skip pre-rename remote fetch]' \
                        '(-n --dry-run)'{-n,--dry-run}'[Show what would happen without executing]' \
                        '(-y --yes)'{-y,--yes}'[Skip confirmation prompt]' \
                        '--include-in-progress[Rename repos even if they have an in-progress git operation]' \
                        '1:new-branch:'
                    ;;
                log)
                    _arguments \
                        '(-F --fetch --no-fetch)'{-F,--fetch}'[Fetch before showing log]' \
                        '(-F --fetch --no-fetch)--no-fetch[Skip fetching (default)]' \
                        '(-n --max-count)'{-n,--max-count}'[Limit commits shown per repo]:count:' \
                        '--json[Output structured JSON]' \
                        '*:repo:($repo_names)'
                    ;;
                diff)
                    _arguments \
                        '(-F --fetch --no-fetch)'{-F,--fetch}'[Fetch before showing diff]' \
                        '(-F --fetch --no-fetch)--no-fetch[Skip fetching (default)]' \
                        '--stat[Show diffstat summary instead of full diff]' \
                        '--json[Output structured JSON]' \
                        '(-d --dirty -w --where)'{-d,--dirty}'[Only diff dirty repos]' \
                        '(-d --dirty -w --where)'{-w,--where}'[Filter repos by status flags]:filter:_arb_where_filter' \
                        '*:repo:($repo_names)'
                    ;;
                template)
                    shift words; (( CURRENT-- ))
                    local -a template_subcmds=(
                        'add:Capture a file as a template'
                        'remove:Remove a template file'
                        'list:List all defined templates'
                        'diff:Show template drift'
                        'apply:Re-seed templates into the current workspace'
                    )
                    if (( CURRENT == 1 )); then
                        _describe 'template command' template_subcmds
                    else
                        case "${words[1]}" in
                            add)
                                shift words; (( CURRENT-- ))
                                _arguments \
                                    '*--repo[Target repo scope]:repo:($repo_names)' \
                                    '--workspace[Target workspace scope]' \
                                    '(-f --force)'{-f,--force}'[Overwrite existing template]' \
                                    '1:file:_files'
                                ;;
                            remove)
                                shift words; (( CURRENT-- ))
                                _arguments \
                                    '*--repo[Target repo scope]:repo:($repo_names)' \
                                    '--workspace[Target workspace scope]' \
                                    '1:template:{ _arb_template_names "$base_dir" }'
                                ;;
                            list) ;;
                            diff)
                                shift words; (( CURRENT-- ))
                                _arguments \
                                    '*--repo[Filter to specific repo]:repo:($repo_names)' \
                                    '--workspace[Filter to workspace templates only]' \
                                    '1:template:{ _arb_template_names "$base_dir" }'
                                ;;
                            apply)
                                shift words; (( CURRENT-- ))
                                _arguments \
                                    '*--repo[Apply only to specific repo]:repo:($repo_names)' \
                                    '--workspace[Apply only workspace templates]' \
                                    '(-f --force)'{-f,--force}'[Overwrite drifted files]' \
                                    '1:template:{ _arb_template_names "$base_dir" }'
                                ;;
                        esac
                    fi
                    ;;
            esac
            ;;
    esac
}
compdef _arb arb
