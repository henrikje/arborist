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

    if [[ "$1" == "delete" ]]; then
        case " ${*:2} " in
            *" --help "*|*" -h "*) command arb delete "${@:2}"; return ;;
        esac
        local _arb_dir
        _arb_dir="$(command arb delete "${@:2}")" || return
        [[ -n "$_arb_dir" ]] && cd "$_arb_dir"
        return
    fi

    if [[ "$1" == "rename" ]]; then
        # Pass help flags through without capturing
        case " ${*:2} " in
            *" --help "*|*" -h "*) command arb rename "${@:2}"; return ;;
        esac
        local _arb_dir
        _arb_dir="$(command arb rename "${@:2}")" || return
        [[ -n "$_arb_dir" ]] && cd "$_arb_dir"
        return
    fi

    if [[ "$1" == "branch" && "$2" == "rename" ]]; then
        # Pass help flags through without capturing
        case " ${*:3} " in
            *" --help "*|*" -h "*) command arb branch rename "${@:3}"; return ;;
        esac
        local _arb_dir
        _arb_dir="$(command arb branch rename "${@:3}")" || return
        [[ -n "$_arb_dir" ]] && cd "$_arb_dir"
        return
    fi

    command arb "$@"
}

_arb_where_filter() {
    local -a all_terms=(
        dirty unpushed behind-share behind-base diverged drifted detached
        operation gone shallow merged base-merged base-missing at-risk stale
        clean pushed synced-base synced-share synced safe
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
    local -a ws_repo_names=()
    if [[ -n "$base_dir" ]]; then
        ws_names=(${base_dir}/*/.arbws(N:h:t))
        [[ -d "$base_dir/.arb/repos" ]] && repo_names=("$base_dir/.arb/repos"/*(N/:t))
        # Detect current workspace and list its worktrees
        local _arb_ws_detect=""
        if [[ "$PWD" == "$base_dir/"* ]]; then
            local _arb_rest="${PWD#$base_dir/}"
            local _arb_first="${_arb_rest%%/*}"
            [[ -n "$_arb_first" && -d "$base_dir/$_arb_first/.arbws" ]] && _arb_ws_detect="$_arb_first"
        fi
        if [[ -n "$_arb_ws_detect" ]]; then
            for _n in "$base_dir/$_arb_ws_detect"/*(N/:t); do
                [[ "$_n" == ".arbws" ]] && continue
                [[ -e "$base_dir/$_arb_ws_detect/$_n/.git" ]] && ws_repo_names+=("$_n")
            done
        fi
    fi

    _arguments -C \
        '-C[Run as if arb was started in <directory>]:directory:_directories' \
        '(-h --help)'{-h,--help}'[Show help]' \
        '(-v --version)'{-v,--version}'[Show version]' \
        '--debug[Enable debug output]' \
        '1:command:->command' \
        '*::arg:->args'

    case "$state" in
        command)
            local -a subcommands=(
                'init:Initialize a new project'
                'repo:Manage canonical repos'
                'create:Create a new workspace'
                'delete:Delete one or more workspaces'
                'rename:Rename the workspace (directory + branch)'
                'list:List all workspaces'
                'path:Print the path to the project root or a workspace'
                'cd:Navigate to a workspace directory'
                'attach:Attach repos to the workspace'
                'detach:Detach repos from the workspace'
                'status:Show workspace status'
                'branch:Inspect and rename the workspace branch'
                'pull:Pull the feature branch from the share remote'
                'push:Push the feature branch to the share remote'
                'rebase:Rebase feature branches onto the base branch'
                'merge:Merge the base branch into feature branches'
                'reset:Reset all repos to the base branch'
                'log:Show feature branch commits across repos'
                'diff:Show feature branch diff across repos'
                'exec:Run a command in each repo'
                'open:Open repos in an application'
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
                        '(-y --yes)'{-y,--yes}'[Skip confirmation prompt]' \
                        '(-a --all-safe)'{-a,--all-safe}'[Remove all safe workspaces]' \
                        '(-w --where)'{-w,--where}'[Filter workspaces by status flags]:filter:_arb_where_filter' \
                        '--older-than[Only delete workspaces not touched in the given duration (e.g. 30d, 2w, 3m, 1y)]:duration:' \
                        '(-n --dry-run)'{-n,--dry-run}'[Show what would happen without executing]' \
                        '(-N --fetch --no-fetch)--fetch[Fetch before assessing workspace status (default)]' \
                        '(-N --fetch --no-fetch)'{-N,--no-fetch}'[Skip fetching]'
                    ;;
                rename)
                    _arguments \
                        '--branch[Set the branch name independently from the workspace name]:branch:' \
                        '--base[Change the base branch]:branch:' \
                        '--continue[Resume an in-progress rename]' \
                        '--abort[Roll back an in-progress rename]' \
                        '(-r --delete-remote)'{-r,--delete-remote}'[Delete old branch on remote after rename]' \
                        '(-N --fetch --no-fetch)--fetch[Fetch before rename (default)]' \
                        '(-N --fetch --no-fetch)'{-N,--no-fetch}'[Skip pre-rename remote fetch]' \
                        '(-n --dry-run)'{-n,--dry-run}'[Show what would happen without executing]' \
                        '(-y --yes)'{-y,--yes}'[Skip confirmation prompt]' \
                        '1:new-name:'
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
                        '(-y --yes)'{-y,--yes}'[Skip interactive prompts and use configured defaults]' \
                        '(-N --fetch --no-fetch)--fetch[Fetch before creating (default)]' \
                        '(-N --fetch --no-fetch)'{-N,--no-fetch}'[Skip pre-fetch]' \
                        '1:name:' \
                        '*:repo:($repo_names)'
                    ;;
                attach)
                    _arguments \
                        '(-a --all-repos)'{-a,--all-repos}'[Add all remaining repos]' \
                        '(-N --fetch --no-fetch)--fetch[Fetch before attaching (default)]' \
                        '(-N --fetch --no-fetch)'{-N,--no-fetch}'[Skip pre-fetch]' \
                        '*:repo:($repo_names)'
                    ;;
                detach)
                    _arguments \
                        '(-f --force)'{-f,--force}'[Force removal even with uncommitted changes]' \
                        '(-a --all-repos)'{-a,--all-repos}'[Drop all repos from the workspace]' \
                        '--delete-branch[Delete the local branch from the canonical repo]' \
                        '(-y --yes)'{-y,--yes}'[Skip confirmation prompt]' \
                        '(-n --dry-run)'{-n,--dry-run}'[Show what would happen without executing]' \
                        '(-N --fetch --no-fetch)--fetch[Fetch before detaching (default)]' \
                        '(-N --fetch --no-fetch)'{-N,--no-fetch}'[Skip pre-fetch]' \
                        '*:repo:($ws_repo_names)'
                    ;;
                repo)
                    shift words; (( CURRENT-- ))
                    if (( CURRENT == 1 )); then
                        local -a repo_subcmds=(
                            'clone:Clone a repo into .arb/repos/'
                            'list:List cloned repos'
                            'remove:Remove canonical repos from .arb/repos/'
                            'default:Manage default repo selection'
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
                                    '(-n --dry-run)'{-n,--dry-run}'[Show what would be removed without removing]' \
                                    '*:repo:($repo_names)'
                                ;;
                            list)
                                shift words; (( CURRENT-- ))
                                _arguments \
                                    '(-q --quiet --json -v --verbose --schema)'{-q,--quiet}'[Output one repo name per line]' \
                                    '(-v --verbose -q --quiet --json --schema)'{-v,--verbose}'[Show remote URLs alongside names]' \
                                    '(--json -q --quiet -v --verbose --schema)--json[Output structured JSON]' \
                                    '(--schema --json -q --quiet -v --verbose)--schema[Print JSON Schema for --json output]'
                                ;;
                            default)
                                shift words; (( CURRENT-- ))
                                _arguments \
                                    '(-r --remove)'{-r,--remove}'[Remove repos from defaults]' \
                                    '*:repo:($repo_names)'
                                ;;
                        esac
                    fi
                    ;;
                init)
                    _arguments '1:path:_directories'
                    ;;
                list)
                    _arguments \
                        '(-N --fetch --no-fetch)--fetch[Fetch workspace repos before listing (default)]' \
                        '(-N --fetch --no-fetch)'{-N,--no-fetch}'[Skip fetching]' \
                        '--no-status[Skip per-repo status (faster for large setups)]' \
                        '(-q --quiet --json --schema)'{-q,--quiet}'[Output one workspace name per line]' \
                        '(-d --dirty -w --where)'{-d,--dirty}'[Only list dirty workspaces]' \
                        '(-d --dirty -w --where)'{-w,--where}'[Filter workspaces by status flags]:filter:_arb_where_filter' \
                        '--older-than[Only list workspaces not touched in the given duration (e.g. 30d, 2w, 3m, 1y)]:duration:' \
                        '--newer-than[Only list workspaces touched within the given duration (e.g. 7d, 2w)]:duration:' \
                        '(--json -q --quiet --schema)--json[Output structured JSON]' \
                        '(--schema --json -q --quiet)--schema[Print JSON Schema for --json output]'
                    ;;
                status)
                    _arguments \
                        '(-d --dirty -w --where)'{-d,--dirty}'[Only show dirty repos]' \
                        '(-d --dirty -w --where)'{-w,--where}'[Filter repos by status flags]:filter:_arb_where_filter' \
                        '(-N --fetch --no-fetch)--fetch[Fetch before showing status (default)]' \
                        '(-N --fetch --no-fetch)'{-N,--no-fetch}'[Skip fetching]' \
                        '(-v --verbose -q --quiet --schema)'{-v,--verbose}'[Show file-level detail]' \
                        '(-q --quiet --json -v --verbose --schema)'{-q,--quiet}'[Output one repo name per line]' \
                        '(--json -q --quiet --schema)--json[Output structured JSON]' \
                        '(--schema --json -q --quiet -v --verbose)--schema[Print JSON Schema for --json output]' \
                        '*:repo:($ws_repo_names)'
                    ;;
                branch)
                    shift words; (( CURRENT-- ))
                    if (( CURRENT == 1 )); then
                        local -a branch_subcmds=(
                            'show:Show the workspace branch (default)'
                            'rename:Rename the workspace branch across all repos'
                            'base:Show, set, or remove the base branch'
                        )
                        _describe 'branch command' branch_subcmds
                        # Also offer show-options since show is the default
                        _arguments \
                            '(-q --quiet --json --schema -v --verbose)'{-q,--quiet}'[Output just the branch name]' \
                            '(-v --verbose -q --quiet --schema)'{-v,--verbose}'[Show per-repo branch and remote tracking detail]' \
                            '(-N --fetch --no-fetch)--fetch[Fetch remotes before displaying]' \
                            '(-N --fetch --no-fetch)'{-N,--no-fetch}'[Skip fetching (default)]' \
                            '(--json -q --quiet --schema)--json[Output structured JSON]' \
                            '(--schema --json -q --quiet -v --verbose)--schema[Print JSON Schema for --json output]'
                    else
                        case "${words[1]}" in
                            show)
                                shift words; (( CURRENT-- ))
                                _arguments \
                                    '(-q --quiet --json --schema -v --verbose)'{-q,--quiet}'[Output just the branch name]' \
                                    '(-v --verbose -q --quiet --schema)'{-v,--verbose}'[Show per-repo branch and remote tracking detail]' \
                                    '(-N --fetch --no-fetch)--fetch[Fetch remotes before displaying]' \
                                    '(-N --fetch --no-fetch)'{-N,--no-fetch}'[Skip fetching (default)]' \
                                    '(--json -q --quiet --schema)--json[Output structured JSON]' \
                                    '(--schema --json -q --quiet -v --verbose)--schema[Print JSON Schema for --json output]'
                                ;;
                            rename)
                                shift words; (( CURRENT-- ))
                                _arguments \
                                    '--continue[Resume an in-progress rename]' \
                                    '--abort[Roll back an in-progress rename]' \
                                    '(-r --delete-remote)'{-r,--delete-remote}'[Delete old branch on remote after rename]' \
                                    '(-N --fetch --no-fetch)--fetch[Fetch before rename (default)]' \
                                    '(-N --fetch --no-fetch)'{-N,--no-fetch}'[Skip pre-rename remote fetch]' \
                                    '(-n --dry-run)'{-n,--dry-run}'[Show what would happen without executing]' \
                                    '(-y --yes)'{-y,--yes}'[Skip confirmation prompt]' \
                                    '--include-in-progress[Rename repos even if they have an in-progress git operation]' \
                                    '1:new-name:'
                                ;;
                            base)
                                shift words; (( CURRENT-- ))
                                _arguments \
                                    '--unset[Remove the base branch (track repo default)]' \
                                    '(-f --force)'{-f,--force}'[Bypass merged-base safety check]' \
                                    '1:branch:'
                                ;;
                        esac
                    fi
                    ;;
                exec)
                    _arguments \
                        '*--repo[Only run in specified repos]:repo:($ws_repo_names)' \
                        '(-d --dirty -w --where)'{-d,--dirty}'[Only run in dirty repos]' \
                        '(-d --dirty -w --where)'{-w,--where}'[Filter repos by status flags]:filter:_arb_where_filter' \
                        '*:command:'
                    ;;
                open)
                    _arguments \
                        '*--repo[Only open specified repos]:repo:($ws_repo_names)' \
                        '(-d --dirty -w --where)'{-d,--dirty}'[Only open dirty worktrees]' \
                        '(-d --dirty -w --where)'{-w,--where}'[Filter worktrees by status flags]:filter:_arb_where_filter' \
                        '1:editor:(code cursor zed subl)'
                    ;;
                pull)
                    _arguments \
                        '(-f --force)'{-f,--force}'[Reset to remote tip, overriding rebased-locally skip]' \
                        '(-y --yes)'{-y,--yes}'[Skip confirmation prompt]' \
                        '(-n --dry-run)'{-n,--dry-run}'[Show what would happen without executing]' \
                        '(-v --verbose)'{-v,--verbose}'[Show incoming commits in the plan]' \
                        '(--merge)--rebase[Pull with rebase]' \
                        '(--rebase)--merge[Pull with merge]' \
                        '--autostash[Stash uncommitted changes before pull, re-apply after]' \
                        '--include-drifted[Include repos on a different branch than the workspace]' \
                        '(-w --where)'{-w,--where}'[Filter repos by status flags]:filter:_arb_where_filter' \
                        '*:repo:($ws_repo_names)'
                    ;;
				push)
					_arguments \
						'(-f --force)'{-f,--force}'[Force push with lease]' \
						'--include-merged[Include branches already merged into base]' \
						'--include-drifted[Include repos on a different branch than the workspace]' \
						'(-N --fetch --no-fetch)--fetch[Fetch before push (default)]' \
						'(-N --fetch --no-fetch)'{-N,--no-fetch}'[Skip fetching before push]' \
						'(-y --yes)'{-y,--yes}'[Skip confirmation prompt]' \
                        '(-n --dry-run)'{-n,--dry-run}'[Show what would happen without executing]' \
                        '(-v --verbose)'{-v,--verbose}'[Show outgoing commits in the plan]' \
                        '(-w --where)'{-w,--where}'[Filter repos by status flags]:filter:_arb_where_filter' \
                        '*:repo:($ws_repo_names)'
                    ;;
                rebase)
                    _arguments \
                        '(-N --fetch --no-fetch)--fetch[Fetch before rebase (default)]' \
                        '(-N --fetch --no-fetch)'{-N,--no-fetch}'[Skip fetching before rebase]' \
                        '(-y --yes)'{-y,--yes}'[Skip confirmation prompt]' \
                        '(-n --dry-run)'{-n,--dry-run}'[Show what would happen without executing]' \
                        '(-v --verbose)'{-v,--verbose}'[Show incoming commits in the plan]' \
                        '(-g --graph)'{-g,--graph}'[Show branch divergence graph in the plan]' \
                        '--retarget=-[Retarget repos whose base has been merged; optionally specify branch]::branch:' \
                        '--autostash[Stash uncommitted changes before rebase, re-apply after]' \
                        '--include-drifted[Include repos on a different branch than the workspace]' \
                        '(-w --where)'{-w,--where}'[Filter repos by status flags]:filter:_arb_where_filter' \
                        '*:repo:($ws_repo_names)'
                    ;;
                merge)
                    _arguments \
                        '(-N --fetch --no-fetch)--fetch[Fetch before merge (default)]' \
                        '(-N --fetch --no-fetch)'{-N,--no-fetch}'[Skip fetching before merge]' \
                        '(-y --yes)'{-y,--yes}'[Skip confirmation prompt]' \
                        '(-n --dry-run)'{-n,--dry-run}'[Show what would happen without executing]' \
                        '(-v --verbose)'{-v,--verbose}'[Show incoming commits in the plan]' \
                        '(-g --graph)'{-g,--graph}'[Show branch divergence graph in the plan]' \
                        '--autostash[Stash uncommitted changes before merge, re-apply after]' \
                        '--include-drifted[Include repos on a different branch than the workspace]' \
                        '(-w --where)'{-w,--where}'[Filter repos by status flags]:filter:_arb_where_filter' \
                        '*:repo:($ws_repo_names)'
                    ;;
                reset)
                    _arguments \
                        '(-N --fetch --no-fetch)--fetch[Fetch before reset (default)]' \
                        '(-N --fetch --no-fetch)'{-N,--no-fetch}'[Skip fetching before reset]' \
                        '--base[Always reset to the base branch]' \
                        '(-y --yes)'{-y,--yes}'[Skip confirmation prompt]' \
                        '(-n --dry-run)'{-n,--dry-run}'[Show what would happen without executing]' \
                        '(-w --where)'{-w,--where}'[Filter repos by status flags]:filter:_arb_where_filter' \
                        '*:repo:($ws_repo_names)'
                    ;;
                log)
                    _arguments \
                        '(-N --fetch --no-fetch)--fetch[Fetch before showing log]' \
                        '(-N --fetch --no-fetch)'{-N,--no-fetch}'[Skip fetching (default)]' \
                        '(-n --max-count)'{-n,--max-count}'[Limit commits shown per repo]:count:' \
                        '(-v --verbose)'{-v,--verbose}'[Show commit bodies and files changed]' \
                        '(--json --schema)--json[Output structured JSON]' \
                        '(--schema --json)--schema[Print JSON Schema for --json output]' \
                        '(-d --dirty -w --where)'{-d,--dirty}'[Only log dirty repos]' \
                        '(-d --dirty -w --where)'{-w,--where}'[Filter repos by status flags]:filter:_arb_where_filter' \
                        '*:repo:($ws_repo_names)'
                    ;;
                diff)
                    _arguments \
                        '(-N --fetch --no-fetch)--fetch[Fetch before showing diff]' \
                        '(-N --fetch --no-fetch)'{-N,--no-fetch}'[Skip fetching (default)]' \
                        '--stat[Show diffstat summary instead of full diff]' \
                        '(--json --schema)--json[Output structured JSON]' \
                        '(--schema --json)--schema[Print JSON Schema for --json output]' \
                        '(-d --dirty -w --where)'{-d,--dirty}'[Only diff dirty repos]' \
                        '(-d --dirty -w --where)'{-w,--where}'[Filter repos by status flags]:filter:_arb_where_filter' \
                        '*:repo:($ws_repo_names)'
                    ;;
                help)
                    local -a help_completions=(
                        'where:Filter syntax for --where'
                        'remotes:Fork workflows and remote roles'
                        'stacked:Stacked workspaces (branching off features)'
                        'templates:Template system quick reference'
                        'scripting:Scripting patterns and conventions'
                        'init:Initialize a new project'
                        'repo:Manage canonical repos'
                        'create:Create a new workspace'
                        'delete:Delete one or more workspaces'
                        'rename:Rename the workspace (directory + branch)'
                                'list:List all workspaces'
                        'path:Print the path to the project root or a workspace'
                        'cd:Navigate to a workspace directory'
                        'attach:Attach repos to the workspace'
                        'detach:Detach repos from the workspace'
                        'status:Show workspace status'
                        'branch:Inspect and rename the workspace branch'
                        'pull:Pull the feature branch from the share remote'
                        'push:Push the feature branch to the share remote'
                        'rebase:Rebase feature branches onto the base branch'
                        'merge:Merge the base branch into feature branches'
                        'reset:Reset all repos to the base branch'
                        'log:Show feature branch commits across repos'
                        'diff:Show feature branch diff across repos'
                        'exec:Run a command in each repo'
                        'open:Open repos in an application'
                        'template:Manage workspace templates'
                    )
                    _describe 'command or topic' help_completions
                    ;;
                template)
                    shift words; (( CURRENT-- ))
                    local -a template_subcmds=(
                        'add:Capture a file or directory as a template'
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
