import { expect, test } from "bun:test";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestEnv } from "./helpers/env";
import { arb, cleanupTestEnv, git, initBareRepo, write } from "./helpers/env";

// ── Walkthrough-specific helpers ─────────────────────────────────

/**
 * Create a walkthrough test environment with 3 bare origin repos
 * (frontend, backend, shared), each with an initial commit.
 * Does NOT run `arb init` or `arb repo clone` — those are test steps.
 */
async function createWalkthroughEnv(): Promise<TestEnv> {
	const testDir = realpathSync(await mkdtemp(join(tmpdir(), "arb-walkthrough-")));
	const projectDir = join(testDir, "project");
	const originDir = join(testDir, "origin");

	await mkdir(projectDir, { recursive: true });
	await mkdir(originDir, { recursive: true });

	for (const name of ["frontend", "backend", "shared"]) {
		const bareDir = join(originDir, `${name}.git`);
		const tmpClone = join(testDir, `tmp-${name}`);

		await initBareRepo(testDir, bareDir, "main");
		await git(testDir, ["clone", bareDir, tmpClone]);

		await write(join(tmpClone, "package.json"), JSON.stringify({ name, version: "1.0.0" }, null, 2));
		await git(tmpClone, ["add", "package.json"]);
		await git(tmpClone, ["commit", "-m", "Initial commit"]);
		await git(tmpClone, ["push"]);

		await rm(tmpClone, { recursive: true });
	}

	return { testDir, projectDir, originDir };
}

/**
 * Simulate a merge on the bare remote — equivalent of _helpers.bash's simulate_merge.
 * Clones the bare repo, merges source into target (fast-forward when possible),
 * pushes, and optionally deletes the source branch on the remote.
 */
async function simulateMerge(
	env: TestEnv,
	repo: string,
	source: string,
	target: string,
	opts?: { deleteBranch?: boolean },
): Promise<void> {
	const bareDir = join(env.originDir, `${repo}.git`);
	const tmpClone = join(env.testDir, `tmp-merge-${repo}`);

	await git(env.testDir, ["clone", bareDir, tmpClone]);
	await git(tmpClone, ["checkout", target]);
	await git(tmpClone, ["merge", `origin/${source}`]);
	await git(tmpClone, ["push"]);

	if (opts?.deleteBranch) {
		await git(bareDir, ["branch", "-D", source]);
	}

	await rm(tmpClone, { recursive: true });
}

// ── Walkthrough test ─────────────────────────────────────────────
//
// Executes every step from the README's "A quick tour" as a single sequential
// test. Each step mutates state the next depends on, so they must run in order.
// Line numbers in assertion failures pinpoint the exact failing step.

test("README walkthrough: init → clone → feature → interrupt → rebase → push → cleanup", async () => {
	const env = await createWalkthroughEnv();

	try {
		// ── Phase 1: Setup ───────────────────────────────────────

		// Step 1: arb init creates project root
		// README: "Initialized arb root"
		const initResult = await arb(env, ["init"]);
		expect(initResult.exitCode).toBe(0);
		expect(initResult.output).toContain("Initialized arb root");
		expect(existsSync(join(env.projectDir, ".arb/repos"))).toBe(true);

		// Step 2: clone frontend, backend, shared
		for (const name of ["frontend", "backend", "shared"]) {
			const result = await arb(env, ["repo", "clone", join(env.originDir, `${name}.git`)]);
			expect(result.exitCode).toBe(0);
		}
		const listResult = await arb(env, ["repo", "list"]);
		expect(listResult.exitCode).toBe(0);
		expect(listResult.output).toContain("frontend");
		expect(listResult.output).toContain("backend");
		expect(listResult.output).toContain("shared");

		// ── Phase 2: Start a feature ─────────────────────────────

		// Step 3: create add-dark-mode workspace (frontend + backend, not shared)
		const createDarkMode = await arb(env, ["create", "add-dark-mode", "frontend", "backend"]);
		expect(createDarkMode.exitCode).toBe(0);
		expect(existsSync(join(env.projectDir, "add-dark-mode/frontend"))).toBe(true);
		expect(existsSync(join(env.projectDir, "add-dark-mode/backend"))).toBe(true);
		expect(existsSync(join(env.projectDir, "add-dark-mode/shared"))).toBe(false);
		const darkModeBranch = (
			await git(join(env.projectDir, "add-dark-mode/frontend"), ["rev-parse", "--abbrev-ref", "HEAD"])
		).trim();
		expect(darkModeBranch).toBe("add-dark-mode");

		// Step 4: commit dark mode changes in frontend
		const dmFrontend = join(env.projectDir, "add-dark-mode/frontend");
		await write(join(dmFrontend, "src/dark-mode.css"), ".dark-mode { background: #1a1a2e; }");
		await git(dmFrontend, ["add", "src/dark-mode.css"]);
		await git(dmFrontend, ["commit", "-m", "Add dark mode toggle to navbar"]);
		const dmLog = await git(dmFrontend, ["log", "--oneline", "-1"]);
		expect(dmLog).toContain("Add dark mode toggle to navbar");

		// Start backend work (uncommitted — mid-flight when the interrupt arrives)
		const dmBackend = join(env.projectDir, "add-dark-mode/backend");
		await write(join(dmBackend, "src/dark-mode-api.js"), "// work in progress");

		// ── Phase 3: Handle an interrupt ─────────────────────────

		// Step 5: create fix-login-crash workspace (frontend only)
		const createFix = await arb(env, ["create", "fix-login-crash", "frontend"]);
		expect(createFix.exitCode).toBe(0);
		expect(existsSync(join(env.projectDir, "fix-login-crash/frontend"))).toBe(true);

		// Step 6: arb list shows both workspaces
		// README: fix-login-crash → "no issues", add-dark-mode → "dirty, unpushed"
		const listBoth = await arb(env, ["list"]);
		expect(listBoth.exitCode).toBe(0);
		expect(listBoth.output).toContain("add-dark-mode");
		expect(listBoth.output).toContain("fix-login-crash");
		expect(listBoth.output).toContain("no issues");
		expect(listBoth.output).toContain("dirty, unpushed");

		// Step 7: commit fix, push, and delete fix-login-crash
		const fixFrontend = join(env.projectDir, "fix-login-crash/frontend");
		await write(join(fixFrontend, "src/login-fix.js"), "// guard against null user");
		await git(fixFrontend, ["add", "src/login-fix.js"]);
		await git(fixFrontend, ["commit", "-m", "Fix null pointer in login flow"]);

		const pushFix = await arb(env, ["push", "--yes"], {
			cwd: join(env.projectDir, "fix-login-crash"),
		});
		expect(pushFix.exitCode).toBe(0);
		expect(pushFix.output).toContain("Pushed 1 repo");

		const deleteFix = await arb(env, ["delete", "fix-login-crash", "--yes", "--force"]);
		expect(deleteFix.exitCode).toBe(0);
		expect(deleteFix.output).toContain("Deleted 1 workspace");
		expect(existsSync(join(env.projectDir, "fix-login-crash"))).toBe(false);

		// ── Phase 4: Simulate hotfix merge on remote ─────────────

		// Step 8: simulate hotfix merge into main, delete branch
		await simulateMerge(env, "frontend", "fix-login-crash", "main", { deleteBranch: true });
		await git(join(env.projectDir, ".arb/repos/frontend"), ["fetch", "--prune"]);
		const remoteBranches = await git(join(env.originDir, "frontend.git"), ["branch"]);
		expect(remoteBranches).not.toContain("fix-login-crash");

		// ── Phase 5: Resume the feature ──────────────────────────

		// Step 9: finish and commit backend work in add-dark-mode
		await write(join(dmBackend, "src/dark-mode-api.js"), "export function getDarkMode() { return true; }");
		await git(dmBackend, ["add", "src/dark-mode-api.js"]);
		await git(dmBackend, ["commit", "-m", "Add dark mode API endpoint"]);
		const backendLog = await git(dmBackend, ["log", "--oneline", "-1"]);
		expect(backendLog).toContain("Add dark mode API endpoint");

		// Step 10: arb status shows frontend behind main
		// README: backend → "1 ahead", frontend → "1 ahead, 1 behind", both → "1 to push"
		const statusBehind = await arb(env, ["status", "--no-fetch"], {
			cwd: join(env.projectDir, "add-dark-mode"),
		});
		expect(statusBehind.exitCode).toBe(0);
		expect(statusBehind.output).toContain("1 ahead, 1 behind");
		expect(statusBehind.output).toContain("1 to push");

		// Step 11: arb rebase integrates upstream changes
		// README: backend → "up to date", frontend → "1 behind, 1 ahead", summary → "Rebased 1 repo"
		const rebaseResult = await arb(env, ["rebase", "--yes"], {
			cwd: join(env.projectDir, "add-dark-mode"),
		});
		expect(rebaseResult.exitCode).toBe(0);
		expect(rebaseResult.output).toContain("up to date");
		expect(rebaseResult.output).toContain("1 behind, 1 ahead");
		expect(rebaseResult.output).toContain("Rebased 1 repo");

		// Step 12: arb status shows repos up to date after rebase (no "behind" anywhere)
		const statusAfter = await arb(env, ["status", "--no-fetch"], {
			cwd: join(env.projectDir, "add-dark-mode"),
		});
		expect(statusAfter.exitCode).toBe(0);
		expect(statusAfter.output).not.toContain("behind");
		expect(statusAfter.output).toContain("1 ahead");

		// Step 13: arb log shows commits across both repos
		const logResult = await arb(env, ["log", "--json"], {
			cwd: join(env.projectDir, "add-dark-mode"),
		});
		expect(logResult.exitCode).toBe(0);
		const json = JSON.parse(logResult.stdout);
		expect(json.totalCommits).toBe(2);
		expect(json.repos.length).toBe(2);
		const subjects = json.repos.flatMap((r: { commits: { subject: string }[] }) => r.commits.map((c) => c.subject));
		expect(subjects).toContain("Add dark mode toggle to navbar");
		expect(subjects).toContain("Add dark mode API endpoint");

		// ── Phase 6: Wrap up ─────────────────────────────────────

		// Step 14: arb push pushes both repos
		const pushAll = await arb(env, ["push", "--yes"], {
			cwd: join(env.projectDir, "add-dark-mode"),
		});
		expect(pushAll.exitCode).toBe(0);
		expect(pushAll.output).toContain("Pushed 2 repos");

		// Step 15: arb delete add-dark-mode cleans up
		const deleteAll = await arb(env, ["delete", "add-dark-mode", "--yes", "--force"]);
		expect(deleteAll.exitCode).toBe(0);
		expect(deleteAll.output).toContain("Deleted 1 workspace");
		expect(existsSync(join(env.projectDir, "add-dark-mode"))).toBe(false);
		const finalList = await arb(env, ["list"]);
		expect(finalList.exitCode).toBe(0);
		expect(finalList.output).not.toContain("add-dark-mode");
		expect(finalList.output).not.toContain("fix-login-crash");
	} finally {
		await cleanupTestEnv(env);
	}
});
