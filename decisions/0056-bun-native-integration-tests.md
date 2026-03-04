# Bun-Native Integration Tests (Remove BATS)

Date: 2026-03-04

## Context

Arborist's integration tests were originally written in BATS (Bash Automated Testing System). BATS tests shell out to the compiled binary and assert on stdout/stderr — a natural fit for CLI testing. However, as the test suite grew to 18 files, pain points accumulated: no type safety in test helpers, awkward string assertions, no IDE support, and a system-installed dependency (`bats`) that wasn't declared in `package.json`.

Meanwhile, Bun's native test runner proved capable of the same end-to-end testing pattern — spawn the compiled binary, capture output, assert — while offering TypeScript helpers, structured assertions (`expect`), concurrent execution, and zero extra dependencies.

## Options

### Keep BATS as the primary integration test framework

Continue writing `.bats` files. Maintain the bash helper library.

- **Pros:** Battle-tested, shell-native, no compilation step for test code.
- **Cons:** No type safety, no IDE support, undeclared system dependency, string-heavy assertions, harder to share fixtures with unit tests.

### Migrate to Bun's native test runner

Port all BATS tests to `.test.ts` files using a TypeScript helper (`env.ts`) that provides the same primitives (`arb()`, `git()`, `createTestEnv()`).

- **Pros:** Single test runner for unit and integration tests, TypeScript throughout, `expect()` assertions, concurrent execution, IDE integration, no external dependency.
- **Cons:** Slightly more boilerplate for simple "run and check output" cases.

### Use a dedicated CLI testing framework (e.g. execa + ava)

Adopt a third-party CLI test harness.

- **Pros:** Purpose-built CLI assertions.
- **Cons:** Another dependency, no meaningful advantage over Bun's built-in runner for this project's needs.

## Decision

Migrate all integration tests to Bun's native test runner and remove BATS entirely.

## Reasoning

Bun is already the project's build tool and unit test runner. Using it for integration tests eliminates the only external test dependency and unifies the test stack. The TypeScript helpers in `test/integration/helpers/env.ts` provide the same isolation guarantees as the BATS helper (`common-setup.bash`) — fresh temp directories, bare origin repos, cleanup — while enabling structured assertions and shared types. All 18 BATS files were ported 1:1 with an additional Bun-only test (`walkthrough.test.ts`). CI and `bun run check` already ran only the Bun tests; BATS was not in the pipeline.

## Consequences

- BATS is no longer used anywhere in the project. No `.bats` files, no `common-setup.bash`, no `test:integration:bats` script.
- All integration tests live in `test/integration/*.test.ts` and run via `bun run test:integration`.
- New integration tests must be written in TypeScript using the helpers in `test/integration/helpers/env.ts`.
- Contributors no longer need BATS installed on their system.
