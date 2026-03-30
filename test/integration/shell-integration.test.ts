import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { arb, type TestEnv, withEnv } from "./helpers/env";

const SHELL_FILE = resolve(join(import.meta.dir, "../../shell/arb.bash"));
const DIST_DIR = resolve(join(import.meta.dir, "../../dist"));

/** Run a bash command that sources the shell integration file. */
async function bash(env: TestEnv, script: string): Promise<{ exitCode: number; output: string; lines: string[] }> {
  const proc = Bun.spawn(["bash", "-c", script], {
    cwd: env.projectDir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1", PATH: `${DIST_DIR}:${process.env.PATH}` },
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  const output = stdout + stderr;
  const lines = output.trimEnd().split("\n");
  return { exitCode, output, lines };
}

// ── wrapper function ─────────────────────────────────────────────

describe("wrapper function", () => {
  test("bash wrapper: arb cd captures path and changes directory", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}'
			arb cd my-feature
			echo "$PWD"
		`,
      );
      expect(result.exitCode).toBe(0);
      const lastLine = result.lines[result.lines.length - 1];
      expect(lastLine).toBe(join(env.projectDir, "my-feature"));
    }));

  test("bash wrapper: arb cd with subpath changes to repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}'
			arb cd my-feature/repo-a
			echo "$PWD"
		`,
      );
      expect(result.exitCode).toBe(0);
      const lastLine = result.lines[result.lines.length - 1];
      expect(lastLine).toBe(join(env.projectDir, "my-feature/repo-a"));
    }));

  test("bash wrapper: arb create captures path and changes directory", () =>
    withEnv(async (env) => {
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}'
			arb create new-ws repo-a 2>/dev/null
			echo "$PWD"
		`,
      );
      expect(result.exitCode).toBe(0);
      const lastLine = result.lines[result.lines.length - 1];
      expect(lastLine).toBe(join(env.projectDir, "new-ws"));
    }));

  test("bash wrapper: arb cd --help passes through without capturing", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}'
			arb cd --help 2>&1
		`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Usage");
    }));

  test("bash wrapper: arb create --help passes through without capturing", () =>
    withEnv(async (env) => {
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}'
			arb create --help 2>&1
		`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Usage");
    }));

  test("bash wrapper: non-cd/create commands pass through to binary", () =>
    withEnv(async (env) => {
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}'
			arb repo list
		`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
    }));

  test("bash wrapper: deleted PWD recovery", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "tmp-ws", "repo-a"]);
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}/tmp-ws/repo-a'
			rm -rf '${env.projectDir}/tmp-ws'
			arb --version
			echo "$PWD"
		`,
      );
      expect(result.exitCode).toBe(0);
      const lastLine = result.lines[result.lines.length - 1];
      // PWD should have recovered to an existing parent directory
      expect(lastLine).not.toBe(join(env.projectDir, "tmp-ws/repo-a"));
    }));

  test("bash wrapper: arb delete navigates to project root when inside deleted workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "doomed", "repo-a"]);
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}/doomed/repo-a'
			arb delete doomed --yes --force 2>/dev/null
			echo "$PWD"
		`,
      );
      expect(result.exitCode).toBe(0);
      const lastLine = result.lines[result.lines.length - 1];
      expect(lastLine).toBe(env.projectDir);
    }));

  test("bash wrapper: arb delete does not navigate when not inside deleted workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "other-ws", "repo-a"]);
      await arb(env, ["create", "safe-ws", "repo-b"]);
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}/safe-ws/repo-b'
			arb delete other-ws --yes --force 2>/dev/null
			echo "$PWD"
		`,
      );
      expect(result.exitCode).toBe(0);
      const lastLine = result.lines[result.lines.length - 1];
      expect(lastLine).toBe(join(env.projectDir, "safe-ws/repo-b"));
    }));

  test("bash wrapper: arb delete --help passes through without capturing", () =>
    withEnv(async (env) => {
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}'
			arb delete --help 2>&1
		`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Usage");
    }));
});

// ── completion: subcommands ──────────────────────────────────────

describe("completion: subcommands", () => {
  test("bash completion: completes subcommand names", () =>
    withEnv(async (env) => {
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}'
			COMP_WORDS=(arb cr)
			COMP_CWORD=1
			_arb
			echo "\${COMPREPLY[*]}"
		`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("create");
    }));

  test("bash completion: completes all subcommands on empty input", () =>
    withEnv(async (env) => {
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}'
			COMP_WORDS=(arb '')
			COMP_CWORD=1
			_arb
			echo "\${COMPREPLY[*]}"
		`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("init");
      expect(result.output).toContain("create");
      expect(result.output).toContain("status");
      expect(result.output).toContain("cd");
      expect(result.output).toContain("repo");
      expect(result.output).toContain("template");
    }));
});

// ── completion: workspace names ──────────────────────────────────

describe("completion: workspace names", () => {
  test("bash completion: cd completes workspace names", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-alpha", "repo-a"]);
      await arb(env, ["create", "ws-beta", "repo-b"]);
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}'
			COMP_WORDS=(arb cd ws-)
			COMP_CWORD=2
			_arb
			echo "\${COMPREPLY[*]}"
		`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-alpha/");
      expect(result.output).toContain("ws-beta/");
    }));

  test("bash completion: remove completes workspace names", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}'
			COMP_WORDS=(arb delete ws)
			COMP_CWORD=2
			_arb
			echo "\${COMPREPLY[*]}"
		`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-one");
    }));
});

// ── completion: repo names ───────────────────────────────────────

describe("completion: repo names", () => {
  test("bash completion: create completes repo names", () =>
    withEnv(async (env) => {
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}'
			COMP_WORDS=(arb create my-feature repo)
			COMP_CWORD=3
			_arb
			echo "\${COMPREPLY[*]}"
		`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("repo-b");
    }));

  test("bash completion: add completes repo names", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}/my-feature'
			COMP_WORDS=(arb attach repo)
			COMP_CWORD=2
			_arb
			echo "\${COMPREPLY[*]}"
		`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("repo-b");
    }));
});

// ── completion: flags ────────────────────────────────────────────

describe("completion: flags", () => {
  test("bash completion: status completes flags", () =>
    withEnv(async (env) => {
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}'
			COMP_WORDS=(arb status --)
			COMP_CWORD=2
			_arb
			echo "\${COMPREPLY[*]}"
		`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("--dirty");
      expect(result.output).toContain("--fetch");
      expect(result.output).toContain("--verbose");
      expect(result.output).toContain("--json");
    }));

  test("bash completion: push completes flags", () =>
    withEnv(async (env) => {
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}'
			COMP_WORDS=(arb push --)
			COMP_CWORD=2
			_arb
			echo "\${COMPREPLY[*]}"
		`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("--force");
      expect(result.output).toContain("--include-merged");
      expect(result.output).toContain("--yes");
      expect(result.output).toContain("--dry-run");
    }));
});

// ── completion: nested subcommands ───────────────────────────────

describe("completion: nested subcommands", () => {
  test("bash completion: repo completes subcommands", () =>
    withEnv(async (env) => {
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}'
			COMP_WORDS=(arb repo '')
			COMP_CWORD=2
			_arb
			echo "\${COMPREPLY[*]}"
		`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("clone");
      expect(result.output).toContain("list");
    }));

  test("bash completion: template completes subcommands", () =>
    withEnv(async (env) => {
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}'
			COMP_WORDS=(arb template '')
			COMP_CWORD=2
			_arb
			echo "\${COMPREPLY[*]}"
		`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("add");
      expect(result.output).toContain("list");
      expect(result.output).toContain("diff");
      expect(result.output).toContain("apply");
    }));
});

// ── completion: scope-aware cd ───────────────────────────────────

describe("completion: scope-aware cd", () => {
  test("bash completion: cd inside workspace completes repo names", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}/my-feature'
			COMP_WORDS=(arb cd repo)
			COMP_CWORD=2
			_arb
			echo "\${COMPREPLY[*]}"
		`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("repo-b");
    }));

  test("bash completion: cd inside workspace also completes workspace names", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-alpha", "repo-a"]);
      await arb(env, ["create", "ws-beta", "repo-b"]);
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}/ws-alpha'
			COMP_WORDS=(arb cd ws-)
			COMP_CWORD=2
			_arb
			echo "\${COMPREPLY[*]}"
		`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-alpha/");
      expect(result.output).toContain("ws-beta/");
    }));

  test("bash wrapper: arb cd with repo name changes directory when inside workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}/my-feature/repo-a'
			arb cd repo-b
			echo "$PWD"
		`,
      );
      expect(result.exitCode).toBe(0);
      const lastLine = result.lines[result.lines.length - 1];
      expect(lastLine).toBe(join(env.projectDir, "my-feature/repo-b"));
    }));
});

// ── completion: cd slash pattern ─────────────────────────────────

describe("completion: cd slash pattern", () => {
  test("bash completion: cd completes repo names after workspace/", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}'
			COMP_WORDS=(arb cd my-feature/)
			COMP_CWORD=2
			_arb
			echo "\${COMPREPLY[*]}"
		`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("my-feature/repo-a");
      expect(result.output).toContain("my-feature/repo-b");
    }));
});

// ── completion: global flags ─────────────────────────────────────

describe("completion: global flags", () => {
  test("bash completion: completes global flags", () =>
    withEnv(async (env) => {
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}'
			COMP_WORDS=(arb -)
			COMP_CWORD=1
			_arb
			echo "\${COMPREPLY[*]}"
		`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("-C");
      expect(result.output).toContain("--help");
      expect(result.output).toContain("--version");
    }));
});

// ── completion: after options ────────────────────────────────────

describe("completion: after options", () => {
  test("bash completion: status completes repo names after -v flag", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}/my-feature'
			COMP_WORDS=(arb status -v repo)
			COMP_CWORD=3
			_arb
			echo "\${COMPREPLY[*]}"
		`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("repo-b");
    }));

  test("bash completion: status completes flags after repo name", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}/my-feature'
			COMP_WORDS=(arb status repo-a --)
			COMP_CWORD=3
			_arb
			echo "\${COMPREPLY[*]}"
		`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("--verbose");
      expect(result.output).toContain("--json");
    }));

  test("bash completion: delete completes workspace names after --yes flag", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}'
			COMP_WORDS=(arb delete --yes ws)
			COMP_CWORD=3
			_arb
			echo "\${COMPREPLY[*]}"
		`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-one");
    }));

  test("bash completion: push completes repo names after --force flag", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}/my-feature'
			COMP_WORDS=(arb push --force repo)
			COMP_CWORD=3
			_arb
			echo "\${COMPREPLY[*]}"
		`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("repo-b");
    }));

  test("bash completion: create completes repo names after -b flag and its value", () =>
    withEnv(async (env) => {
      const result = await bash(
        env,
        `
			source '${SHELL_FILE}'
			cd '${env.projectDir}'
			COMP_WORDS=(arb create my-ws -b my-branch repo)
			COMP_CWORD=5
			_arb
			echo "\${COMPREPLY[*]}"
		`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("repo-b");
    }));
});
