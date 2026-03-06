import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { arb, git, initBareRepo, withEnv, write } from "./helpers/env";

// ── exec ─────────────────────────────────────────────────────────

describe("exec", () => {
  test("arb exec runs in each repo, skips .arbws/", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["exec", "echo", "hello"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.output).toContain("==> repo-a <==");
      expect(result.output).toContain("==> repo-b <==");
      expect(result.output).toContain("hello");
      expect(result.output).not.toContain(".arbws");
    }));

  test("arb exec pwd runs in each repo directory", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["exec", "pwd"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.output).toContain("/my-feature/repo-a");
      expect(result.output).toContain("/my-feature/repo-b");
    }));

  test("arb exec returns non-zero if any command fails", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["exec", "false"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
    }));

  test("arb exec without args fails", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["exec"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("missing required argument");
    }));

  test("arb exec with nonexistent command fails cleanly", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["exec", "nonexistent-command-xyz"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("not found in PATH");
    }));

  test("arb exec without workspace context fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["exec", "echo", "hi"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Not inside a workspace");
    }));

  test("arb exec --dirty runs only in dirty repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["exec", "--dirty", "pwd"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb exec -d runs only in dirty repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["exec", "-d", "pwd"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb exec passes flags through to the command", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const spy = join(env.testDir, "exec-spy");
      await writeFile(
        spy,
        `#!/usr/bin/env bash\nfor arg in "$@"; do printf '%s\\n' "$arg"; done >> "${env.testDir}/exec-args"\n`,
      );
      await chmod(spy, 0o755);
      const result = await arb(env, ["exec", spy, "-d", "--verbose", "-x"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const args = await readFile(join(env.testDir, "exec-args"), "utf8");
      expect(args).toContain("-d");
      expect(args).toContain("--verbose");
      expect(args).toContain("-x");
    }));

  test("arb exec combines arb flags with pass-through flags", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const spy = join(env.testDir, "exec-spy");
      await writeFile(
        spy,
        `#!/usr/bin/env bash\nfor arg in "$@"; do printf '%s\\n' "$arg"; done >> "${env.testDir}/exec-args"\n`,
      );
      await chmod(spy, 0o755);
      const result = await arb(env, ["exec", "--dirty", spy, "-d", "--verbose"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      // --dirty filtered to repo-a only; -d and --verbose passed through
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
      const args = await readFile(join(env.testDir, "exec-args"), "utf8");
      expect(args).toContain("-d");
      expect(args).toContain("--verbose");
    }));
});

// ── open ─────────────────────────────────────────────────────────

describe("open", () => {
  test("arb open opens all repos by default with single invocation", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const spy = join(env.testDir, "editor-spy");
      await writeFile(
        spy,
        `#!/usr/bin/env bash\nfor arg in "$@"; do echo "$arg"; done >> "${env.testDir}/opened-dirs"\n`,
      );
      await chmod(spy, 0o755);
      const result = await arb(env, ["open", spy], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const opened = await readFile(join(env.testDir, "opened-dirs"), "utf8");
      expect(opened).toContain("repo-a");
      expect(opened).toContain("repo-b");
    }));

  test("arb open invokes editor once with all dirs", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const spy = join(env.testDir, "editor-spy");
      await writeFile(spy, `#!/usr/bin/env bash\necho "invocation" >> "${env.testDir}/invocations"\n`);
      await chmod(spy, 0o755);
      const result = await arb(env, ["open", spy], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const invocations = await readFile(join(env.testDir, "invocations"), "utf8");
      const count = invocations.trim().split("\n").length;
      expect(count).toBe(1);
    }));

  test("arb open --dirty opens only dirty repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const spy = join(env.testDir, "editor-spy");
      await writeFile(
        spy,
        `#!/usr/bin/env bash\nfor arg in "$@"; do echo "$arg"; done >> "${env.testDir}/opened-dirs"\n`,
      );
      await chmod(spy, 0o755);
      const result = await arb(env, ["open", "--dirty", spy], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const opened = await readFile(join(env.testDir, "opened-dirs"), "utf8");
      expect(opened).toContain("repo-a");
      expect(opened).not.toContain("repo-b");
    }));

  test("arb open -d opens only dirty repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const spy = join(env.testDir, "editor-spy");
      await writeFile(
        spy,
        `#!/usr/bin/env bash\nfor arg in "$@"; do echo "$arg"; done >> "${env.testDir}/opened-dirs"\n`,
      );
      await chmod(spy, 0o755);
      const result = await arb(env, ["open", "-d", spy], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const opened = await readFile(join(env.testDir, "opened-dirs"), "utf8");
      expect(opened).toContain("repo-a");
      expect(opened).not.toContain("repo-b");
    }));

  test("arb open passes flags through to the command", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const spy = join(env.testDir, "editor-spy");
      await writeFile(
        spy,
        `#!/usr/bin/env bash\nfor arg in "$@"; do printf '%s\\n' "$arg"; done >> "${env.testDir}/opened-args"\n`,
      );
      await chmod(spy, 0o755);
      const result = await arb(env, ["open", spy, "--extra-flag", "-n"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const args = await readFile(join(env.testDir, "opened-args"), "utf8");
      expect(args).toContain("--extra-flag");
      expect(args).toContain("-n");
      expect(args).toContain("repo-a");
      expect(args).toContain("repo-b");
    }));

  test("arb open combines arb flags with pass-through flags", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const spy = join(env.testDir, "editor-spy");
      await writeFile(
        spy,
        `#!/usr/bin/env bash\nfor arg in "$@"; do printf '%s\\n' "$arg"; done >> "${env.testDir}/opened-args"\n`,
      );
      await chmod(spy, 0o755);
      const result = await arb(env, ["open", "--dirty", spy, "--extra-flag", "-n"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const args = await readFile(join(env.testDir, "opened-args"), "utf8");
      expect(args).toContain("--extra-flag");
      expect(args).toContain("-n");
      expect(args).toContain("repo-a");
      expect(args).not.toContain("repo-b");
    }));

  test("arb open --dirty shows no match when all clean", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["open", "--dirty", "true"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.output).toContain("No repos match the filter");
    }));

  test("arb open without command fails", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["open"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
    }));

  test("arb open with nonexistent editor fails", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["open", "nonexistent-editor-xyz"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("not found in PATH");
    }));
});

// ── -w as --where short form ──────────────────────────────────────

describe("-w as --where short form", () => {
  test("arb status -w dirty filters repos (short for --where)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      const result = await arb(env, ["status", "-w", "dirty"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb -w as global option is rejected", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["-w", "dirty", "status"]);
      expect(result.exitCode).not.toBe(0);
    }));
});

// ── remoteless repo validation ────────────────────────────────────

describe("remoteless repo validation", () => {
  test("arb create with remoteless repo errors with actionable message", () =>
    withEnv(async (env) => {
      await git(join(env.projectDir, ".arb/repos"), ["init", "local-lib"]);
      await git(join(env.projectDir, ".arb/repos/local-lib"), ["commit", "--allow-empty", "-m", "init"]);
      const result = await arb(env, ["create", "local-ws", "local-lib"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("local-lib");
      expect(result.output).toContain("remote");
    }));

  test("arb create with ambiguous remotes errors with actionable message", () =>
    withEnv(async (env) => {
      // Create a repo with two non-conventional remotes and no pushDefault
      await initBareRepo(env.testDir, join(env.originDir, "ambig.git"), "main");
      await initBareRepo(env.testDir, join(env.testDir, "fork/ambig.git"), "main");
      await git(env.testDir, ["clone", join(env.originDir, "ambig.git"), join(env.projectDir, ".arb/repos/ambig")]);
      await git(join(env.projectDir, ".arb/repos/ambig"), ["commit", "--allow-empty", "-m", "init"]);
      await git(join(env.projectDir, ".arb/repos/ambig"), ["push"]);
      // Add a second remote named "fork" (not "upstream", so convention doesn't apply)
      await git(join(env.projectDir, ".arb/repos/ambig"), [
        "remote",
        "add",
        "fork",
        join(env.testDir, "fork/ambig.git"),
      ]);
      // Do NOT set pushDefault -- this makes remotes ambiguous
      const result = await arb(env, ["create", "ambig-ws", "ambig"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("ambig");
      expect(result.output).toContain("remote");
    }));
});

// ── --dry-run flag ───────────────────────────────────────────────

describe("--dry-run flag", () => {
  test("arb push --dry-run shows plan without pushing", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "change"]);
      const result = await arb(env, ["push", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("1 commit");
      expect(result.output).toContain("to push");
      expect(result.output).toContain("Dry run");
      // Must NOT contain the execution summary
      expect(result.output).not.toContain("Pushed");
      // Verify nothing was actually pushed
      const branchResult = await git(join(env.originDir, "repo-a.git"), ["branch"]);
      expect(branchResult).not.toContain("my-feature");
    }));

  test("arb push -n short flag works", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "change"]);
      const result = await arb(env, ["push", "-n"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("to push");
      expect(result.output).toContain("Dry run");
      expect(result.output).not.toContain("Pushed");
    }));

  test("arb push --dry-run when up to date shows up to date", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);
      const result = await arb(env, ["push", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("up to date");
    }));

  test("arb pull --dry-run shows plan without pulling", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await write(join(env.projectDir, "my-feature/repo-a/file.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "file.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "change"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);

      // Push a new commit from another clone
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), join(env.testDir, "tmp-clone")]);
      await git(join(env.testDir, "tmp-clone"), ["checkout", "my-feature"]);
      await write(join(env.testDir, "tmp-clone/r.txt"), "remote");
      await git(join(env.testDir, "tmp-clone"), ["add", "r.txt"]);
      await git(join(env.testDir, "tmp-clone"), ["commit", "-m", "remote commit"]);
      await git(join(env.testDir, "tmp-clone"), ["push"]);

      const result = await arb(env, ["pull", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("to pull");
      expect(result.output).toContain("Dry run");
      // Must NOT contain the execution summary
      expect(result.output).not.toContain("Pulled");
      // Verify nothing was actually pulled
      expect(existsSync(join(env.projectDir, "my-feature/repo-a/r.txt"))).toBe(false);
    }));

  test("arb rebase --dry-run shows plan without rebasing", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      // Push upstream change so rebase has work to do
      await write(join(env.projectDir, ".arb/repos/repo-a/upstream.txt"), "upstream");
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["add", "upstream.txt"]);
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["commit", "-m", "upstream"]);
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["push"]);

      const result = await arb(env, ["rebase", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("rebase my-feature onto");
      expect(result.output).toContain("Dry run");
      // Must NOT contain the execution summary
      expect(result.output).not.toContain("Rebased");
      // Verify the upstream commit is NOT reachable (rebase didn't happen)
      const logOutput = await git(join(env.projectDir, "my-feature/repo-a"), ["log", "--oneline"]);
      expect(logOutput).not.toContain("upstream");
    }));

  test("arb merge --dry-run shows plan without merging", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);

      await write(join(env.projectDir, ".arb/repos/repo-a/upstream.txt"), "upstream");
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["add", "upstream.txt"]);
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["commit", "-m", "upstream"]);
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["push"]);

      const result = await arb(env, ["merge", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toMatch(/merge.*into my-feature/);
      expect(result.output).toContain("Dry run");
      // Must NOT contain the execution summary
      expect(result.output).not.toContain("Merged");
      // Verify the upstream commit is NOT reachable (merge didn't happen)
      const logOutput = await git(join(env.projectDir, "my-feature/repo-a"), ["log", "--oneline"]);
      expect(logOutput).not.toContain("upstream");
    }));

  test("arb delete --dry-run shows status without removing", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["delete", "my-feature", "--dry-run"], {
        cwd: env.projectDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("my-feature");
      expect(result.output).toContain("WORKSPACE");
      expect(result.output).toContain("Dry run");
      // Must NOT contain the execution summary
      expect(result.output).not.toContain("Deleted");
      // Verify the workspace still exists
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(true);
    }));

  test("arb delete --all-safe --dry-run shows workspaces without removing", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      await git(join(env.projectDir, "ws-one/repo-a"), ["push", "-u", "origin", "ws-one"]);
      await arb(env, ["create", "ws-two", "repo-b"]);
      await git(join(env.projectDir, "ws-two/repo-b"), ["push", "-u", "origin", "ws-two"]);
      const result = await arb(env, ["delete", "--all-safe", "--dry-run"], {
        cwd: env.projectDir,
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-one");
      expect(result.output).toContain("ws-two");
      expect(result.output).toContain("Dry run");
      // Must NOT contain the execution summary
      expect(result.output).not.toContain("Deleted");
      // Verify both workspaces still exist
      expect(existsSync(join(env.projectDir, "ws-one"))).toBe(true);
      expect(existsSync(join(env.projectDir, "ws-two"))).toBe(true);
    }));
});

// ── --where filtering ─────────────────────────────────────────────

describe("--where filtering", () => {
  test("arb status --where dirty filters repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["status", "--where", "dirty"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb status --where gone shows only gone repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      // Push repo-a, then delete the remote branch to make it "gone"
      await write(join(env.projectDir, "my-feature/repo-a/f.txt"), "change");
      await git(join(env.projectDir, "my-feature/repo-a"), ["add", "f.txt"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["commit", "-m", "commit"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["push", "-u", "origin", "my-feature"]);
      await git(join(env.originDir, "repo-a.git"), ["branch", "-D", "my-feature"]);
      await git(join(env.projectDir, "my-feature/repo-a"), ["fetch", "--prune"]);
      const result = await arb(env, ["status", "--where", "gone"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb status --where dirty --json filters JSON output", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["status", "--where", "dirty", "--json"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb status --where invalid shows helpful error", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["status", "--where", "invalid"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Unknown filter term: invalid");
      expect(result.output).toContain("Valid terms:");
    }));

  test("arb status --where comma-separated uses OR logic", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["status", "--where", "dirty,gone"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb status --dirty --where errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["status", "--dirty", "--where", "dirty"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Cannot combine --dirty with --where");
    }));

  test("arb exec --where dirty runs only in dirty repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["exec", "--where", "dirty", "pwd"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb exec --where dirty+unpushed runs only in repos matching both", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      // repo-a: dirty only
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      // repo-b: dirty AND unpushed
      await write(join(env.projectDir, "my-feature/repo-b/dirty.txt"), "dirty");
      await git(join(env.projectDir, "my-feature/repo-b"), ["add", "-A"]);
      await git(join(env.projectDir, "my-feature/repo-b"), ["commit", "-m", "unpushed"]);
      await write(join(env.projectDir, "my-feature/repo-b/dirty2.txt"), "more");
      const result = await arb(env, ["exec", "--where", "dirty+unpushed", "pwd"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-b");
      expect(result.output).not.toContain("repo-a");
    }));

  test("arb exec --where dirty+unpushed skips repos matching only one term", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      // repo-a: dirty only (no unpushed commits)
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["exec", "--where", "dirty+unpushed", "pwd"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb exec --dirty still works as shortcut", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["exec", "--dirty", "pwd"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb exec --repo runs only in specified repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["exec", "--repo", "repo-a", "pwd"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb exec --repo with multiple repos runs in all specified", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["exec", "--repo", "repo-a", "--repo", "repo-b", "pwd"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("repo-b");
    }));

  test("arb exec --repo with invalid repo name errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["exec", "--repo", "nonexistent", "pwd"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Repo 'nonexistent' is not in this workspace");
    }));

  test("arb exec --repo combined with --dirty uses AND logic", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      await write(join(env.projectDir, "my-feature/repo-b/dirty.txt"), "dirty");
      const result = await arb(env, ["exec", "--repo", "repo-a", "--dirty", "pwd"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb open --repo opens only specified repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const spy = join(env.testDir, "editor-spy");
      await writeFile(
        spy,
        `#!/usr/bin/env bash\nfor arg in "$@"; do echo "$arg"; done >> "${env.testDir}/opened-dirs"\n`,
      );
      await chmod(spy, 0o755);
      const result = await arb(env, ["open", "--repo", "repo-a", spy], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const opened = await readFile(join(env.testDir, "opened-dirs"), "utf8");
      expect(opened).toContain("repo-a");
      expect(opened).not.toContain("repo-b");
    }));

  test("arb open --repo with multiple repos opens all specified", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const spy = join(env.testDir, "editor-spy");
      await writeFile(
        spy,
        `#!/usr/bin/env bash\nfor arg in "$@"; do echo "$arg"; done >> "${env.testDir}/opened-dirs"\n`,
      );
      await chmod(spy, 0o755);
      const result = await arb(env, ["open", "--repo", "repo-a", "--repo", "repo-b", spy], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const opened = await readFile(join(env.testDir, "opened-dirs"), "utf8");
      expect(opened).toContain("repo-a");
      expect(opened).toContain("repo-b");
    }));

  test("arb open --repo with invalid repo name errors", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["open", "--repo", "nonexistent", "true"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Repo 'nonexistent' is not in this workspace");
    }));

  test("arb open --repo combined with --dirty uses AND logic", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      await write(join(env.projectDir, "my-feature/repo-b/dirty.txt"), "dirty");
      const spy = join(env.testDir, "editor-spy");
      await writeFile(
        spy,
        `#!/usr/bin/env bash\nfor arg in "$@"; do echo "$arg"; done >> "${env.testDir}/opened-dirs"\n`,
      );
      await chmod(spy, 0o755);
      const result = await arb(env, ["open", "--repo", "repo-a", "--dirty", spy], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const opened = await readFile(join(env.testDir, "opened-dirs"), "utf8");
      expect(opened).toContain("repo-a");
      expect(opened).not.toContain("repo-b");
    }));
});
