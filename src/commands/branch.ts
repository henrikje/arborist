import { basename } from "node:path";
import type { Command } from "commander";
import { configGet } from "../lib/config";
import { ArbError } from "../lib/errors";
import { git } from "../lib/git";
import { GitCache } from "../lib/git-cache";
import { printSchema } from "../lib/json-schema";
import { type BranchJsonOutput, BranchJsonOutputSchema, type BranchJsonRepo } from "../lib/json-types";
import { dim, error, stderr, yellow } from "../lib/output";
import { fetchSuffix, parallelFetch, reportFetchFailures } from "../lib/parallel-fetch";
import { runPhasedRender } from "../lib/phased-render";
import { workspaceRepoDirs } from "../lib/repos";
import { type RepoStatus, gatherWorkspaceSummary } from "../lib/status";
import { ITEM_INDENT, SECTION_INDENT } from "../lib/status-verbose";
import { type Column, renderTable } from "../lib/table";
import { isTTY } from "../lib/tty";
import type { ArbContext } from "../lib/types";
import { workspaceBranch } from "../lib/workspace-branch";
import { requireWorkspace } from "../lib/workspace-context";

interface RepoBranch {
	name: string;
	branch: string | null;
}

interface VerboseRow {
	name: string;
	branch: string;
	base: string;
	share: string;
	branchNoteworthy: boolean;
}

export function registerBranchCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("branch")
		.option("-q, --quiet", "Output just the branch name")
		.option("-v, --verbose", "Show per-repo branch and remote tracking detail")
		.option("--fetch", "Fetch remotes before displaying (default in verbose mode)")
		.option("-N, --no-fetch", "Skip fetching")
		.option("--json", "Output structured JSON")
		.option("--schema", "Print JSON Schema for this command's --json output and exit")
		.summary("Show the workspace branch")
		.description(
			"Show the workspace branch, base branch (if configured), and any per-repo deviations. Use --verbose to show a per-repo table with branch and remote tracking info (fetches by default; use -N to skip). Use --quiet to output just the branch name (useful for scripting). Use --json for machine-readable output.\n\nSee 'arb help scripting' for output modes and piping.",
		)
		.action(
			async (options: { quiet?: boolean; verbose?: boolean; json?: boolean; fetch?: boolean; schema?: boolean }) => {
				if (options.schema) {
					if (options.json || options.quiet || options.verbose) {
						error("Cannot combine --schema with --json, --quiet, or --verbose.");
						throw new ArbError("Cannot combine --schema with --json, --quiet, or --verbose.");
					}
					printSchema(BranchJsonOutputSchema);
					return;
				}
				const ctx = getCtx();
				requireWorkspace(ctx);
				await runBranch(ctx, options);
			},
		);
}

async function runBranch(
	ctx: ArbContext,
	options: { quiet?: boolean; verbose?: boolean; json?: boolean; fetch?: boolean },
): Promise<void> {
	const wsDir = `${ctx.arbRootDir}/${ctx.currentWorkspace}`;
	const configFile = `${wsDir}/.arbws/config`;

	if (options.quiet && options.json) {
		error("Cannot combine --quiet with --json.");
		throw new ArbError("Cannot combine --quiet with --json.");
	}

	if (options.quiet && options.verbose) {
		error("Cannot combine --quiet with --verbose.");
		throw new ArbError("Cannot combine --quiet with --verbose.");
	}

	const wb = await workspaceBranch(wsDir);
	const branch = wb?.branch ?? (ctx.currentWorkspace as string);
	const base = configGet(configFile, "base");

	if (options.verbose) {
		await runVerboseBranch(ctx, wsDir, branch, base, options);
		return;
	}

	// Gather per-repo branches
	const repoDirs = workspaceRepoDirs(wsDir);
	const repos: RepoBranch[] = await Promise.all(
		repoDirs.map(async (dir) => {
			const result = await git(dir, "branch", "--show-current");
			const repoBranch = result.exitCode === 0 ? result.stdout.trim() || null : null;
			return { name: basename(dir), branch: repoBranch };
		}),
	);

	if (options.quiet) {
		process.stdout.write(`${branch}\n`);
		return;
	}

	if (options.json) {
		const output: BranchJsonOutput = {
			branch,
			base: base ?? null,
			repos: repos.map((r) => ({ name: r.name, branch: r.branch })),
		};
		process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
		return;
	}

	// Default table output
	const baseDisplay = base ?? "(default branch)";

	interface SummaryRow {
		branch: string;
		base: string;
	}

	const summaryColumns: Column<SummaryRow>[] = [
		{ header: "BRANCH", value: (row) => row.branch },
		{ header: "BASE", value: (row) => row.base, render: (row) => (base ? row.base : dim(row.base)) },
	];

	let output = renderTable(summaryColumns, [{ branch, base: baseDisplay }]);

	// Per-repo deviations
	const deviations = repos.filter((r) => r.branch !== branch);
	if (deviations.length > 0) {
		output += `\n${SECTION_INDENT}${yellow("Repos on a different branch:")}\n`;
		for (const r of deviations) {
			const label = r.branch === null ? "(detached)" : r.branch;
			output += `${ITEM_INDENT}${r.name}    ${label}\n`;
		}
	}

	process.stdout.write(output);
}

// ── Verbose mode ──────────────────────────────────────────────────

async function runVerboseBranch(
	ctx: ArbContext,
	wsDir: string,
	branch: string,
	base: string | null,
	options: { json?: boolean; fetch?: boolean },
): Promise<void> {
	const cache = new GitCache();
	const repoDirs = workspaceRepoDirs(wsDir);

	if (options.fetch !== false && !options.json && isTTY()) {
		// Phased rendering: stale → fetch → fresh
		const repoNames = repoDirs.map((d) => basename(d));
		const fetchPromise = cache
			.resolveRemotesMap(repoNames, ctx.reposDir)
			.then((remotesMap) => parallelFetch(repoDirs, undefined, remotesMap, { silent: true }));

		const state: { fetchResults?: Map<string, { exitCode: number; output: string }> } = {};

		await runPhasedRender([
			{
				render: async () => {
					const summary = await gatherWorkspaceSummary(wsDir, ctx.reposDir, undefined, cache);
					return renderVerboseOutput(summary.repos, branch, base) + fetchSuffix(repoNames.length);
				},
				write: stderr,
			},
			{
				render: async () => {
					state.fetchResults = await fetchPromise;
					cache.invalidateAfterFetch();
					const summary = await gatherWorkspaceSummary(wsDir, ctx.reposDir, undefined, cache);
					return renderVerboseOutput(summary.repos, branch, base);
				},
				write: (output) => process.stdout.write(output),
			},
		]);
		reportFetchFailures(repoNames, state.fetchResults as Map<string, { exitCode: number; output: string }>);
		return;
	}

	if (options.fetch !== false) {
		// Non-TTY: blocking fetch then render
		const repoNames = repoDirs.map((d) => basename(d));
		const remotesMap = await cache.resolveRemotesMap(repoNames, ctx.reposDir);
		const results = await parallelFetch(repoDirs, undefined, remotesMap, options.json ? { silent: true } : undefined);
		cache.invalidateAfterFetch();
		reportFetchFailures(repoNames, results);
	}

	const summary = await gatherWorkspaceSummary(wsDir, ctx.reposDir, undefined, cache);

	if (options.json) {
		process.stdout.write(formatVerboseJson(summary.repos, branch, base));
		return;
	}

	process.stdout.write(renderVerboseOutput(summary.repos, branch, base));
}

function buildVerboseRows(repos: RepoStatus[], branch: string): VerboseRow[] {
	return repos.map((repo) => {
		const { headMode } = repo.identity;
		const detached = headMode.kind === "detached";
		const actualBranch = headMode.kind === "attached" ? headMode.branch : "(detached)";
		const isDrifted = headMode.kind === "attached" && headMode.branch !== branch;

		// Base column: show the resolved base ref (e.g. "origin/main")
		let base = "";
		if (!detached && repo.base) {
			base = repo.base.remote ? `${repo.base.remote}/${repo.base.ref}` : repo.base.ref;
		}

		// Share column: show the share tracking ref or status
		let share = "";
		if (!detached) {
			switch (repo.share.refMode) {
				case "configured":
				case "implicit":
					share = repo.share.ref ?? "";
					break;
				case "noRef":
					share = "(local only)";
					break;
				case "gone":
					share = "(gone)";
					break;
			}
		}

		const branchNoteworthy = detached || isDrifted;

		return { name: repo.name, branch: actualBranch, base, share, branchNoteworthy };
	});
}

function renderVerboseOutput(repos: RepoStatus[], branch: string, base: string | null): string {
	// Workspace-level header (same as default mode)
	const baseDisplay = base ?? "(default branch)";

	interface SummaryRow {
		branch: string;
		base: string;
	}

	const summaryColumns: Column<SummaryRow>[] = [
		{ header: "BRANCH", value: (row) => row.branch },
		{ header: "BASE", value: (row) => row.base, render: (row) => (base ? row.base : dim(row.base)) },
	];

	let out = renderTable(summaryColumns, [{ branch, base: baseDisplay }]);
	out += "\n";

	// Per-repo table
	const rows = buildVerboseRows(repos, branch);

	const columns: Column<VerboseRow>[] = [
		{
			header: "REPO",
			value: (row) => row.name,
		},
		{
			header: "BRANCH",
			value: (row) => row.branch,
			render: (row) => (row.branchNoteworthy ? yellow(row.branch) : row.branch),
		},
		{
			header: "BASE",
			value: (row) => row.base,
		},
		{
			header: "SHARE",
			value: (row) => row.share,
		},
	];

	out += renderTable(columns, rows);
	return out;
}

function formatVerboseJson(repos: RepoStatus[], branch: string, base: string | null): string {
	const jsonRepos: BranchJsonRepo[] = repos.map((repo) => {
		const { headMode } = repo.identity;
		const repoBranch = headMode.kind === "attached" ? headMode.branch : null;

		// Base ref
		let baseRef: string | null = null;
		if (headMode.kind === "attached" && repo.base) {
			baseRef = repo.base.remote ? `${repo.base.remote}/${repo.base.ref}` : repo.base.ref;
		}

		// Share ref
		let share: string | null = null;
		if (headMode.kind === "attached") {
			switch (repo.share.refMode) {
				case "configured":
				case "implicit":
					share = repo.share.ref ?? null;
					break;
			}
		}

		return {
			name: repo.name,
			branch: repoBranch,
			base: baseRef,
			share,
			refMode: repo.share.refMode,
		};
	});

	const output: BranchJsonOutput = { branch, base: base ?? null, repos: jsonRepos };
	return `${JSON.stringify(output, null, 2)}\n`;
}
