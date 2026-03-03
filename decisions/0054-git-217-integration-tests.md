# Git 2.17 Integration Tests

Date: 2026-03-03

## Context

Arborist enforces git 2.17 as its minimum version (decision 0053), but all tests run against whatever modern git ships with the CI runner or developer machine. There is no automated way to verify that arb actually works on 2.17. Since git 2.17 is too old for any distro package manager, testing against it requires a custom environment.

## Options

### Docker image with git compiled from source

Build a reusable Docker image containing git 2.17 (compiled from source) and Bun. At test time, bind-mount the project directory and run the integration tests inside the container.

- **Pros:** Separates slow git compilation (cached in Docker layers) from fast test iteration; portable; reusable for other git versions; no changes to the host system
- **Cons:** Requires Docker; first build is slow (~2 min for compilation)

### Nix flake with pinned git

Use Nix to provide a reproducible git 2.17 environment.

- **Pros:** Declarative; reproducible
- **Cons:** Requires Nix; harder to integrate into CI; less familiar to most contributors

### Skip testing on old git

Trust that the minimum version check is sufficient and don't test against old git.

- **Pros:** No maintenance burden
- **Cons:** Regressions against old git go undetected; features requiring newer git may not be properly gated

## Decision

Use a Docker image with git compiled from source, run via a `bun run test:integration:git217` script and a manual-trigger GitHub Actions workflow.

## Reasoning

Docker is the most portable and cacheable approach. The multi-stage build keeps the runtime image small while caching the expensive compilation step. Rather than a wrapper script that intercepts git commands (fragile shell argument parsing, hidden behavior), the test harness uses 2.17-compatible git commands directly: `initBareRepo()` replaces `git init -b` with plumbing commands (hash-object + commit-tree + update-ref), and `git symbolic-ref --short HEAD` replaces `git branch --show-current`. Version-gated `describe.skipIf` blocks handle features that genuinely require newer git (workspace rename needs `worktree repair` from 2.30+, conflict prediction needs `merge-tree --write-tree` from 2.38+).

## Consequences

- A new `bun run test:integration:git217` script lets developers verify git 2.17 compatibility locally
- The `GIT_VERSION` build arg allows testing other git versions in the future
- Tests requiring newer git features must use `describe.skipIf` with version constants from `test/integration/helpers/env.ts`
- The workflow is manual-trigger only to avoid slowing down the normal CI pipeline
