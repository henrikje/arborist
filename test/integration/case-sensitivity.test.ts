import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { arb, git, gitBelow230, isCaseSensitiveFS, withEnv } from "./helpers/env";

// ── workspace name collisions (case-insensitive FS) ──────────────

describe.skipIf(isCaseSensitiveFS)("workspace name case collisions (case-insensitive FS)", () => {
  test("arb create detects case-variant collision", () =>
    withEnv(async (env) => {
      const first = await arb(env, ["create", "My-Feature", "repo-a"]);
      expect(first.exitCode).toBe(0);

      const second = await arb(env, ["create", "my-feature", "repo-b"]);
      expect(second.exitCode).not.toBe(0);
      expect(second.output).toContain("already exists");
    }));

  test("arb create collision error mentions existing workspace casing", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "My-Feature", "repo-a"]);
      const result = await arb(env, ["create", "my-feature", "repo-b"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("My-Feature");
    }));
});

// ── workspace name collisions (case-sensitive FS) ────────────────

describe.skipIf(!isCaseSensitiveFS)("workspace name case on case-sensitive FS", () => {
  test("arb create with case-variant name succeeds", () =>
    withEnv(async (env) => {
      const first = await arb(env, ["create", "My-Feature", "repo-a"]);
      expect(first.exitCode).toBe(0);

      const second = await arb(env, ["create", "my-feature", "repo-b"]);
      expect(second.exitCode).toBe(0);

      expect(existsSync(join(env.projectDir, "My-Feature"))).toBe(true);
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(true);
    }));
});

// ── branch ref collisions (case-insensitive FS) ──────────────────

describe.skipIf(isCaseSensitiveFS)("branch ref case collisions (case-insensitive FS)", () => {
  test("case-variant branch on same repo should be blocked", () =>
    withEnv(async (env) => {
      const first = await arb(env, ["create", "ws-a", "--branch", "Feature", "repo-a"]);
      expect(first.exitCode).toBe(0);

      const second = await arb(env, ["create", "ws-b", "--branch", "feature", "repo-a"]);
      expect(second.exitCode).not.toBe(0);
    }));

  test("case-variant branch collision error mentions workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-a", "--branch", "Feature", "repo-a"]);
      const result = await arb(env, ["create", "ws-b", "--branch", "feature", "repo-a"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("ws-a");
    }));

  test("git show-ref matches case-variant branch when ref is loose", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-a", "--branch", "Feature", "repo-a"]);
      const canonicalRepo = join(env.projectDir, ".arb/repos/repo-a");
      const result = await git(canonicalRepo, ["show-ref", "--verify", "--quiet", "refs/heads/feature"]);
      expect(result).toBeDefined();
    }));
});

// ── branch ref collisions (case-sensitive FS) ────────────────────

describe.skipIf(!isCaseSensitiveFS)("branch ref case on case-sensitive FS", () => {
  test("case-variant branches on same repo are independent", () =>
    withEnv(async (env) => {
      const first = await arb(env, ["create", "ws-a", "--branch", "Feature", "repo-a"]);
      expect(first.exitCode).toBe(0);

      const second = await arb(env, ["create", "ws-b", "--branch", "feature", "repo-a"]);
      expect(second.exitCode).toBe(0);

      expect(existsSync(join(env.projectDir, "ws-a/repo-a"))).toBe(true);
      expect(existsSync(join(env.projectDir, "ws-b/repo-a"))).toBe(true);
    }));
});

// ── case-only workspace rename (case-insensitive FS) ─────────────

describe.skipIf(isCaseSensitiveFS || gitBelow230)("case-only rename on case-insensitive FS", () => {
  test("arb rename with case-only change should succeed", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["rename", "My-Feature", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const config = await readFile(join(env.projectDir, "My-Feature/.arbws/config.json"), "utf8");
      expect(JSON.parse(config).branch).toBe("My-Feature");
      const branch = (await git(join(env.projectDir, "My-Feature/repo-a"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branch).toBe("My-Feature");
    }));

  test("arb branch rename with case-only change should succeed", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["branch", "rename", "My-Feature", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const config = await readFile(join(env.projectDir, "my-feature/.arbws/config.json"), "utf8");
      expect(JSON.parse(config).branch).toBe("My-Feature");
      const branch = (await git(join(env.projectDir, "my-feature/repo-a"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branch).toBe("My-Feature");
    }));
});

// ── case-only workspace rename (case-sensitive FS) ───────────────

describe.skipIf(!isCaseSensitiveFS || gitBelow230)("case-only rename on case-sensitive FS", () => {
  test("arb rename with case-only change succeeds", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["rename", "My-Feature", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "My-Feature"))).toBe(true);
      expect(existsSync(join(env.projectDir, "my-feature"))).toBe(false);
      const config = await readFile(join(env.projectDir, "My-Feature/.arbws/config.json"), "utf8");
      expect(JSON.parse(config).branch).toBe("My-Feature");
    }));

  test("arb branch rename with case-only change succeeds", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["branch", "rename", "My-Feature", "--yes", "--no-fetch"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).toBe(0);
      const config = await readFile(join(env.projectDir, "my-feature/.arbws/config.json"), "utf8");
      expect(JSON.parse(config).branch).toBe("My-Feature");
    }));
});

// ── repo name matching (both platforms) ──────────────────────────

describe("repo name case matching", () => {
  test("arb push with wrong-case repo name fails", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["push", "Repo-A", "--dry-run"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Repo-A");
    }));

  test("arb exec --repo with wrong-case repo name fails", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["exec", "--repo", "Repo-A", "--", "ls"], {
        cwd: join(env.projectDir, "my-feature"),
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Repo-A");
    }));
});

// ── status and listing (both platforms) ──────────────────────────

describe("mixed-case workspace names", () => {
  test("arb status works with mixed-case workspace name", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "My-Feature", "repo-a"]);
      const result = await arb(env, ["status", "--no-fetch"], {
        cwd: join(env.projectDir, "My-Feature"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("My-Feature");
    }));

  test("arb status --json preserves mixed-case workspace name", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "My-Feature", "repo-a"]);
      const result = await arb(env, ["status", "--json", "--no-fetch"], {
        cwd: join(env.projectDir, "My-Feature"),
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.workspace).toBe("My-Feature");
    }));

  test("arb list preserves original case", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "My-Feature", "repo-a"]);
      const result = await arb(env, ["list"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("My-Feature");
    }));
});
