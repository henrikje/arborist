# TODO

This file contains a prioritized list of planned or potential improvements to Arborist.

## P0 — Strengthen the core (what must be nailed)

**1. README: surface automation and robustness story**
The biggest takeaway from this review is that the tool's strongest qualities are invisible. A reader evaluating Arborist sees none of: `--yes`, `--json`, exit codes, conflict recovery, per-repo default branch detection, partial workspace handling. Consider:
- A "Scripting & automation" section covering `--yes`, `--json`, exit codes, non-TTY behavior
- Mentioning conflict detection/recovery in the rebase/merge command docs
- Noting that different default branches per repo are auto-detected

**2. Invest further in `arb status` as the killer feature**
The reviewer's strongest insight: *"If `arb status` becomes indispensable, the tool wins."* Status already shows base drift, origin drift, dirty state, at-risk detection, and conflict state. Potential enhancements:
- A compact summary line at the bottom (e.g. "3 repos clean, 1 needs rebase, 1 has unpushed commits") to make quick scanning even faster
- Consider whether `--verbose` output could show the specific commits that are ahead/behind

## P1 — Distribution (high ROI, real adoption barrier)

**3. Versioned GitHub releases with precompiled binaries**
The reviewer correctly identifies this as the biggest practical weakness. Source-build requiring Bun is friction. Actions:
- CI pipeline that cross-compiles for macOS arm64/x64 and Linux arm64/x64 via `bun build --target`
- GitHub Releases with semver tags and binaries
- Update `install.sh` to download precompiled binaries instead of building from source (fall back to source build if no matching binary)

**4. Homebrew tap**
Low effort once releases exist. Creates the "one-liner install" experience engineers expect.

**5. Bash shell integration**
The installer currently only auto-configures zsh. The shell helper (`arb.zsh`) provides the `arb` wrapper function for `cd` behavior. A `arb.bash` equivalent would widen adoption. Fish is lower priority but worth considering.

## P2 — Real-world Git complexity (matters at scale)

**6. Multiple remotes (fork + upstream workflows)**
Currently hardcoded to `origin` throughout. This is the most significant functional gap for teams using fork-based workflows (common in open source and many orgs). This would need:
- A way to configure which remote to push to vs fetch from
- Probably project-level config (`.arb/config`) to set remote preferences per repo

This is a significant architectural change. Worth designing carefully rather than rushing. Could start with just documenting that arb assumes `origin` as a known limitation.

**7. Per-repo base branch overrides**
Currently `base` in `.arbws/config` applies to all repos in a workspace. In practice, repos within the same project sometimes have different default branches (e.g. one uses `main`, another uses `develop`). The auto-detection via `getDefaultBranch()` handles most cases, but explicit per-repo overrides in project config would be more robust.

## P3 — Nice-to-have enhancements

**8. Repo groups**
The reviewer suggests "frontend-set" style grouping. This would be useful for projects with 10+ repos where you commonly operate on subsets. Lower priority until arb sees usage at that scale.

**9. Parallel `exec` mode**
Currently sequential (by design, for interactive safety). An optional `--parallel` flag for non-interactive commands (like `arb exec -- make build`) could speed up large setups. Needs careful output grouping and failure semantics.

**10. Branch naming templates**
`feature/{name}` style templates. Low priority — the current simple string approach works well and adding templates adds complexity for minimal gain at current scale.

## Rejected / deprioritized

**Submodules/nested repos**: Out of scope. Arborist manages worktrees of independent repos. Supporting submodules would add significant complexity for a rare use case that conflicts with the multi-repo model.

**Windows support**: Not a current target. The tool is built for Unix environments and the target audience (multi-repo developers) overwhelmingly uses macOS/Linux.

**Project-level `.arb/config`**: The reviewer suggests this as a general config system. Worth considering as the vehicle for items 6-8 above, but should only be introduced when there's a concrete need (e.g. multi-remote support) rather than as speculative infrastructure.

**Changelogs**: Premature for current stage. Versioned releases (P1) are the priority; changelogs can come later.
