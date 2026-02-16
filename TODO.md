# TODO

This file contains a prioritized list of planned or potential improvements to Arborist.

## Priority 1 – Must-haves

- **Set up PR-based development flow for Arborist itself.**
Arborist is designed for push-based workflows with feature branches and pull requests, but the project itself isn't using that flow yet. Dogfooding this would exercise the real workflow arb is built for. Actions:
  - Enable branch protection on `main` (require PR, no direct push)
  - Set up CI checks (lint, typecheck, tests) as required status checks on PRs
  - Use `arb` itself to manage development (create workspaces, push branches)

- **Versioned GitHub releases with precompiled binaries.**
The reviewer correctly identifies this as the biggest practical weakness. Source-build requiring Bun is friction. Actions:
  - CI pipeline that cross-compiles for macOS arm64/x64 and Linux arm64/x64 via `bun build --target`
  - GitHub Releases with semver tags and binaries
  - Update `install.sh` to download precompiled binaries instead of building from source (fall back to source build if no matching binary). 
  - Homebrew tap: Low effort once releases exist. Creates the "one-liner install" experience engineers expect.

- **Bash shell integration**
The installer currently only auto-configures zsh. The shell helper (`arb.zsh`) provides the `arb` wrapper function for `cd` behavior. A `arb.bash` equivalent would widen adoption. Fish is lower priority but worth considering.

## Priority 2 — Nice-to-have enhancements

- **Repo groups**
The reviewer suggests "frontend-set" style grouping. This would be useful for projects with 10+ repos where you commonly operate on subsets. A natural special case is a "default" group — repos that are always included when creating a new workspace, so you don't have to select them every time. Could be configured in `.arb/config` (e.g. `[groups "default"]` with a list of repos). Lower priority until arb sees usage at that scale.

- **Parallel `exec` mode**
Currently sequential (by design, for interactive safety). An optional `--parallel` flag for non-interactive commands (like `arb exec -- make build`) could speed up large setups. Needs careful output grouping and failure semantics.

- **`--` pass-through for commands that invoke external programs**
`exec` uses `.allowUnknownOption(true)` and a greedy argument, but flags that collide with arb's own options (e.g. `arb exec npm test -d` where `-d` is `--dirty`) get swallowed by Commander instead of reaching the target command. `open` doesn't accept target-program arguments at all, so `arb open code --profile myprofile` fails. Using Commander's `.passThroughOptions()` and treating everything after `--` as opaque would fix both: `arb exec -d -- npm test -d`, `arb open -- code --profile myprofile`. The same pattern could apply to any future command that delegates to external programs.

- **Branch naming templates**
`feature/{name}` style templates. Low priority — the current simple string approach works well and adding templates adds complexity for minimal gain at current scale.

## Rejected / deprioritized

**Submodules/nested repos**: Out of scope. Arborist manages worktrees of independent repos. Supporting submodules would add significant complexity for a rare use case that conflicts with the multi-repo model.

**Windows support**: Not a current target. The tool is built for Unix environments and the target audience (multi-repo developers) overwhelmingly uses macOS/Linux.

**Project-level `.arb/config`**: The reviewer suggests this as a general config system. Worth considering as the vehicle for the P2 items above, but should only be introduced when there's a concrete need (e.g. multi-remote support) rather than as speculative infrastructure.

**Changelogs**: Premature for current stage. Versioned releases (P1) are the priority; changelogs can come later.
