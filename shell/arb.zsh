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

    if [[ "${1:-}" == "cd" ]]; then
        local dir
        dir="$(command arb path "${@:2}")" || return 1
        cd "$dir"
    else
        command arb "$@"
    fi
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
        '(-w --workspace)'{-w,--workspace}'[Workspace name]:workspace:($ws_names)' \
        '(-h --help)'{-h,--help}'[Show help]' \
        '(-v --version)'{-v,--version}'[Show version]' \
        '1:command:->command' \
        '*::arg:->args'

    case "$state" in
        command)
            local -a subcommands=(
                'init:Initialize a directory as an arb root'
                'clone:Clone a repo'
                'repos:List cloned repos'
                'create:Create a new workspace'
                'remove:Remove a workspace'
                'list:List all workspaces'
                'path:Print the path to the arb root or a workspace'
                'cd:Change directory to a workspace'
                'add:Add worktrees to the workspace'
                'drop:Drop worktrees from the workspace'
                'status:Show worktree status'
                'fetch:Fetch from origin'
                'pull:Pull the feature branch from origin'
                'push:Push the feature branch to origin'
                'exec:Run a command in each worktree'
                'open:Run a command with worktrees as arguments'
                'help:Show help'
            )
            _describe 'command' subcommands
            ;;
        args)
            case "${words[1]}" in
                remove)
                    _arguments \
                        '1:workspace:($ws_names)' \
                        '(-f --force)'{-f,--force}'[Force removal]' \
                        '(-d --delete-remote)'{-d,--delete-remote}'[Delete remote branches]'
                    ;;
                path|cd)
                    _arguments '1:workspace:($ws_names)'
                    ;;
                create)
                    _arguments \
                        '(-b --branch)'{-b,--branch}'[Branch name]:branch:' \
                        '(-a --all-repos)'{-a,--all-repos}'[Include all repos in this root]' \
                        '1:name:' \
                        '*:repo:($repo_names)'
                    ;;
                add)
                    _arguments '*:repo:($repo_names)'
                    ;;
                drop)
                    _arguments \
                        '(-f --force)'{-f,--force}'[Force removal even with uncommitted changes]' \
                        '--delete-branch[Delete the local branch from the canonical repo]' \
                        '*:repo:($repo_names)'
                    ;;
                clone)
                    _arguments '1:url:' '2:name:'
                    ;;
                init)
                    _arguments '1:path:_directories'
                    ;;
                status)
                    _arguments \
                        '(-d --dirty)'{-d,--dirty}'[Only show dirty repos]'
                    ;;
                exec)
                    _arguments \
                        '(-d --dirty)'{-d,--dirty}'[Only run in dirty repos]' \
                        '*:command:'
                    ;;
                open)
                    _arguments \
                        '(-d --dirty)'{-d,--dirty}'[Only open dirty worktrees]' \
                        '1:editor:(code cursor zed subl)'
                    ;;
            esac
            ;;
    esac
}
compdef _arb arb
