import { describe, expect, test } from "bun:test";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { arb, withEnv, write } from "./helpers/env";

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

  test("arb exec --parallel runs in all repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["exec", "--parallel", "echo", "hello"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("==> repo-a <==");
      expect(result.output).toContain("==> repo-b <==");
      expect(result.output).toContain("hello");
    }));

  test("arb exec --parallel outputs repos in alphabetical order", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["exec", "--parallel", "echo", "done"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const aIdx = result.output.indexOf("==> repo-a <==");
      const bIdx = result.output.indexOf("==> repo-b <==");
      expect(aIdx).toBeLessThan(bIdx);
    }));

  test("arb exec -p works as shorthand for --parallel", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["exec", "-p", "echo", "hello"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("hello");
    }));

  test("arb exec --parallel reports failures", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["exec", "--parallel", "false"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Failed:");
    }));

  test("arb exec --parallel --repo targets specific repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["exec", "--parallel", "--repo", "repo-a", "pwd"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("==> repo-b <==");
    }));

  test("arb exec --parallel --dirty runs only in dirty repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await write(join(env.projectDir, "my-feature/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["exec", "--parallel", "--dirty", "pwd"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).not.toContain("repo-b");
    }));

  test("arb exec --parallel shows success summary", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["exec", "--parallel", "true"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Ran in 2 repos");
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
