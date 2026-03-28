import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { arb, git, initBareRepo, withEnv, write } from "./helpers/env";

// ── create ───────────────────────────────────────────────────────

describe("create", () => {
  test("arb create creates workspace with .arbws/config.json", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "--all-repos"]);
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(true);
      expect(existsSync(join(env.projectDir, "my-feature/.arbws"))).toBe(true);
      expect(existsSync(join(env.projectDir, "my-feature/.arbws/config.json"))).toBe(true);
    }));

  test(".arbws/config.json contains correct branch", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "--all-repos"]);
      const content = await readFile(join(env.projectDir, "my-feature/.arbws/config.json"), "utf8");
      expect(JSON.parse(content).branch).toBe("my-feature");
    }));

  test("arb create with repos creates workspace repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      expect(existsSync(join(env.projectDir, "my-feature/repo-a"))).toBe(true);
      expect(existsSync(join(env.projectDir, "my-feature/repo-b"))).toBe(true);
    }));

  test("arb create --all-repos creates workspace repos for all repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "all-ws", "--all-repos"]);
      expect(existsSync(join(env.projectDir, "all-ws/repo-a"))).toBe(true);
      expect(existsSync(join(env.projectDir, "all-ws/repo-b"))).toBe(true);
    }));

  test("arb create -a creates workspace repos for all repos", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "all-ws", "-a"]);
      expect(existsSync(join(env.projectDir, "all-ws/repo-a"))).toBe(true);
      expect(existsSync(join(env.projectDir, "all-ws/repo-b"))).toBe(true);
    }));

  test("arb create --branch stores custom branch in config", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "payments", "--branch", "feat/payments", "repo-a"]);
      const content = await readFile(join(env.projectDir, "payments/.arbws/config.json"), "utf8");
      expect(JSON.parse(content).branch).toBe("feat/payments");
    }));

  test("arb create -b stores custom branch in config", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "payments", "-b", "feat/payments", "repo-a"]);
      const content = await readFile(join(env.projectDir, "payments/.arbws/config.json"), "utf8");
      expect(JSON.parse(content).branch).toBe("feat/payments");
    }));

  test("arb create attaches existing branch", () =>
    withEnv(async (env) => {
      const canonicalRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(canonicalRepoA, ["checkout", "-b", "reuse-me"]);
      await write(join(canonicalRepoA, "marker.txt"), "branch-content");
      await git(canonicalRepoA, ["add", "marker.txt"]);
      await git(canonicalRepoA, ["commit", "-m", "marker"]);
      await git(canonicalRepoA, ["checkout", "-"]);

      await arb(env, ["create", "reuse-ws", "--branch", "reuse-me", "repo-a"]);
      expect(existsSync(join(env.projectDir, "reuse-ws/repo-a/marker.txt"))).toBe(true);
      const branch = (await git(join(env.projectDir, "reuse-ws/repo-a"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branch).toBe("reuse-me");
    }));

  test("arb create checks out existing remote branch", () =>
    withEnv(async (env) => {
      const canonicalRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(canonicalRepoA, ["checkout", "-b", "remote-only"]);
      await write(join(canonicalRepoA, "remote-marker.txt"), "remote-content");
      await git(canonicalRepoA, ["add", "remote-marker.txt"]);
      await git(canonicalRepoA, ["commit", "-m", "remote marker"]);
      await git(canonicalRepoA, ["push", "-u", "origin", "remote-only"]);
      await git(canonicalRepoA, ["checkout", "--detach", "HEAD"]);
      await git(canonicalRepoA, ["branch", "-D", "remote-only"]);

      await arb(env, ["create", "remote-ws", "--branch", "remote-only", "repo-a"]);

      expect(existsSync(join(env.projectDir, "remote-ws/repo-a/remote-marker.txt"))).toBe(true);
      const branch = (await git(join(env.projectDir, "remote-ws/repo-a"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branch).toBe("remote-only");
      const trackingRemote = (
        await git(join(env.projectDir, "remote-ws/repo-a"), ["config", "branch.remote-only.remote"])
      ).trim();
      expect(trackingRemote).toBe("origin");
    }));

  test("arb create remote branch sets tracking even with autoSetupMerge off", () =>
    withEnv(async (env) => {
      const canonicalRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(canonicalRepoA, ["config", "branch.autoSetupMerge", "false"]);
      await git(canonicalRepoA, ["checkout", "-b", "no-auto-track"]);
      await write(join(canonicalRepoA, "no-auto.txt"), "no-auto-content");
      await git(canonicalRepoA, ["add", "no-auto.txt"]);
      await git(canonicalRepoA, ["commit", "-m", "no-auto marker"]);
      await git(canonicalRepoA, ["push", "-u", "origin", "no-auto-track"]);
      await git(canonicalRepoA, ["checkout", "--detach", "HEAD"]);
      await git(canonicalRepoA, ["branch", "-D", "no-auto-track"]);

      await arb(env, ["create", "no-auto-ws", "--branch", "no-auto-track", "repo-a"]);

      const trackingRemote = (
        await git(join(env.projectDir, "no-auto-ws/repo-a"), ["config", "branch.no-auto-track.remote"])
      ).trim();
      expect(trackingRemote).toBe("origin");
    }));

  test("arb create outputs workspace path on stdout", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "foo", "repo-a"]);
      expect(result.stdout.trim()).toBe(join(env.projectDir, "foo"));
    }));

  test("arb create path output is clean when stdout is captured (shell wrapper pattern)", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "capture-test", "repo-a"]);
      expect(result.stdout.trim()).toBe(join(env.projectDir, "capture-test"));
    }));

  test("arb create shows workspace path", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "path-test", "repo-a"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain(join(env.projectDir, "path-test"));
    }));

  test("arb create with duplicate workspace name fails", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["create", "my-feature", "repo-b"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("already exists");
    }));

  test("arb create with no repos fails in non-TTY", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "no-repos-ws"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Usage: arb create");
    }));

  test("arb create without name fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Usage: arb create");
    }));

  test("arb create --branch without name derives workspace name from branch tail", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "--branch", "claude/improve-arb-create-ux-Ipru1", "--all-repos"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Workspace: improve-arb-create-ux-Ipru1");
      expect(result.output).toContain("derived from branch");
      const wsDir = join(env.projectDir, "improve-arb-create-ux-Ipru1");
      expect(existsSync(wsDir)).toBe(true);
      expect(existsSync(join(wsDir, "repo-a"))).toBe(true);
      expect(existsSync(join(wsDir, "repo-b"))).toBe(true);
      const config = await readFile(join(wsDir, ".arbws/config.json"), "utf8");
      expect(JSON.parse(config).branch).toBe("claude/improve-arb-create-ux-Ipru1");
    }));

  test("arb create --branch without name fails when derived workspace already exists", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "existing-tail", "repo-a"]);
      const result = await arb(env, ["create", "--branch", "claude/existing-tail", "--all-repos"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Derived workspace name 'existing-tail'");
      expect(result.output).toContain("already exists");
    }));

  test("arb create --branch without value in non-TTY fails with guidance", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "foo", "--branch"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("--branch requires a value in non-interactive mode");
    }));

  test("arb create -b without value in non-TTY fails with same guidance", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "foo", "-b"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("--branch requires a value in non-interactive mode");
    }));

  test("arb create --branch without value combined with --yes fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "foo", "--branch", "--yes"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("--branch without a value");
      expect(result.output).toContain("--yes");
    }));

  test("arb create with invalid branch name fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "bad-ws", "--branch", "bad branch name with spaces", "repo-a"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Invalid branch name");
    }));

  test("arb create rejects name with slash", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "bad/name"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("must not contain '/'");
    }));

  test("arb create with slash name suggests --branch usage when input looks like branch", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "claude/improve-arb-create-ux-Ipru1"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("may have pasted a branch name");
      expect(result.output).toContain("arb create --branch claude/improve-arb-create-ux-Ipru1");
    }));

  test("arb create rejects name with path traversal", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "foo..bar"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("must not contain '..'");
    }));

  test("arb create rejects name with whitespace", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "bad name"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("must not contain whitespace");
    }));

  test("arb create with nonexistent repo fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "ws-bad", "badrepo"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Unknown repos: badrepo");
      expect(result.output).toContain("Not found in .arb/repos/");
    }));

  test("arb create with name and repos derives branch without interactive prompts", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "FeatureFoo", "repo-a", "repo-b"]);
      expect(result.exitCode).toBe(0);
      const config = await readFile(join(env.projectDir, "FeatureFoo/.arbws/config.json"), "utf8");
      expect(JSON.parse(config).branch).toBe("FeatureFoo");
      expect(existsSync(join(env.projectDir, "FeatureFoo/repo-a"))).toBe(true);
      expect(existsSync(join(env.projectDir, "FeatureFoo/repo-b"))).toBe(true);
    }));

  test("arb create with name, repos, and --branch skips branch derivation", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "my-ws", "-b", "custom/branch", "repo-a"]);
      expect(result.exitCode).toBe(0);
      const config = await readFile(join(env.projectDir, "my-ws/.arbws/config.json"), "utf8");
      expect(JSON.parse(config).branch).toBe("custom/branch");
    }));

  test("arb create with --base stores base without interactive prompt", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "stacked-ws", "-b", "feat/ui", "--base", "feat/core", "repo-a"]);
      expect(result.exitCode).toBe(0);
      const config = await readFile(join(env.projectDir, "stacked-ws/.arbws/config.json"), "utf8");
      expect(JSON.parse(config).branch).toBe("feat/ui");
      expect(JSON.parse(config).base).toBe("feat/core");
    }));

  test("arb create without --base omits base from config in non-TTY", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "no-base-ws", "repo-a"]);
      expect(result.exitCode).toBe(0);
      const config = await readFile(join(env.projectDir, "no-base-ws/.arbws/config.json"), "utf8");
      expect(JSON.parse(config).branch).toBe("no-base-ws");
      expect(JSON.parse(config).base).toBeUndefined();
    }));

  test("arb create checks out existing remote branch with name on CLI", () =>
    withEnv(async (env) => {
      const canonicalRepoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(canonicalRepoA, ["checkout", "-b", "shared-feat"]);
      await write(join(canonicalRepoA, "shared.txt"), "shared");
      await git(canonicalRepoA, ["add", "shared.txt"]);
      await git(canonicalRepoA, ["commit", "-m", "shared commit"]);
      await git(canonicalRepoA, ["push", "-u", "origin", "shared-feat"]);
      await git(canonicalRepoA, ["checkout", "--detach", "HEAD"]);
      await git(canonicalRepoA, ["branch", "-D", "shared-feat"]);

      const result = await arb(env, ["create", "collab-ws", "-b", "shared-feat", "repo-a"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "collab-ws/repo-a/shared.txt"))).toBe(true);
      const branch = (await git(join(env.projectDir, "collab-ws/repo-a"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branch).toBe("shared-feat");
    }));

  test("arb create aborts and cleans up when a worktree fails", () =>
    withEnv(async (env) => {
      // Create workspace A with repo-a on branch feat/conflict
      await arb(env, ["create", "ws-a", "--branch", "feat/conflict", "repo-a"]);
      expect(existsSync(join(env.projectDir, "ws-a/repo-a"))).toBe(true);

      // Attempt to create workspace B with both repos on the same branch
      // repo-a should fail (branch already checked out in ws-a)
      const result = await arb(env, ["create", "ws-b", "--branch", "feat/conflict", "repo-a", "repo-b"]);
      expect(result.exitCode).not.toBe(0);

      // Workspace B should not exist (rolled back)
      expect(existsSync(join(env.projectDir, "ws-b"))).toBe(false);

      // repo-b should not have the branch (rolled back)
      const canonicalRepoB = join(env.projectDir, ".arb/repos/repo-b");
      const branchCheck = await git(canonicalRepoB, ["branch", "--list", "feat/conflict"]);
      expect(branchCheck.trim()).toBe("");

      // Error should mention the workspace name
      expect(result.stderr).toContain("workspace 'ws-a'");

      // Workspace A should be unaffected
      const branchA = (await git(join(env.projectDir, "ws-a/repo-a"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branchA).toBe("feat/conflict");
    }));

  test("arb create aborts even when some repos succeed before a failure", () =>
    withEnv(async (env) => {
      // Create workspace A with repo-b on branch feat/partial
      await arb(env, ["create", "ws-a", "--branch", "feat/partial", "repo-b"]);

      // Attempt to create workspace B with repo-a (will succeed) then repo-b (will fail)
      const result = await arb(env, ["create", "ws-b", "--branch", "feat/partial", "repo-a", "repo-b"]);
      expect(result.exitCode).not.toBe(0);

      // Workspace B should not exist (rolled back)
      expect(existsSync(join(env.projectDir, "ws-b"))).toBe(false);

      // repo-a's newly created branch should be cleaned up
      const canonicalRepoA = join(env.projectDir, ".arb/repos/repo-a");
      const branchCheck = await git(canonicalRepoA, ["branch", "--list", "feat/partial"]);
      expect(branchCheck.trim()).toBe("");
    }));
});

// ── create info lines ─────────────────────────────────────────────

describe("create info lines", () => {
  test("name + repos shows all four lines with hints on branch and base", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "my-ws", "repo-a", "repo-b"]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("Workspace: my-ws");
      expect(result.stderr).toContain("Branch: my-ws");
      expect(result.stderr).toContain("same as workspace, use --branch to override");
      expect(result.stderr).toContain("Base: repo default");
      expect(result.stderr).toContain("use --base to override");
      expect(result.stderr).toContain("Repos: repo-a, repo-b");
    }));

  test("name + --branch + repos shows branch without hint", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "my-ws", "--branch", "feat/thing", "repo-a"]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("Workspace: my-ws");
      expect(result.stderr).toContain("Branch: feat/thing");
      expect(result.stderr).not.toContain("same as workspace");
      expect(result.stderr).toContain("Base: repo default");
      expect(result.stderr).toContain("Repos: repo-a");
    }));

  test("--branch only + --all-repos shows workspace derived from branch", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "--branch", "feat/thing", "-a"]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("Workspace: thing");
      expect(result.stderr).toContain("derived from branch");
      expect(result.stderr).toContain("Branch: feat/thing");
      expect(result.stderr).not.toContain("same as workspace");
    }));

  test("all explicit + repos shows no hints on branch or base", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "my-ws", "--branch", "feat/thing", "--base", "develop", "repo-a"]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("Workspace: my-ws");
      expect(result.stderr).toContain("Branch: feat/thing");
      expect(result.stderr).not.toContain("same as workspace");
      expect(result.stderr).toContain("Base: develop");
      expect(result.stderr).not.toContain("use --base to override");
      expect(result.stderr).toContain("Repos: repo-a");
    }));

  test("name + --base + repos shows branch with hint, base without hint", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "my-ws", "--base", "develop", "repo-a"]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("Branch: my-ws");
      expect(result.stderr).toContain("same as workspace, use --branch to override");
      expect(result.stderr).toContain("Base: develop");
      expect(result.stderr).not.toContain("use --base to override");
    }));

  test("name + --all-repos shows repos line as all", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["create", "my-ws", "-a"]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("Workspace: my-ws");
      expect(result.stderr).toContain("Repos: all");
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
