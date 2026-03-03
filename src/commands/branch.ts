import { basename } from "node:path";
import type { Command } from "commander";
import { ArbError, configGet } from "../lib/core";
import type { ArbContext } from "../lib/core";
import { GitCache, assertMinimumGitVersion, git } from "../lib/git";
import { printSchema } from "../lib/json";
import { type BranchJsonOutput, BranchJsonOutputSchema, type BranchJsonRepo } from "../lib/json";
import { type RenderContext, render } from "../lib/render";
import { cell } from "../lib/render";
import type { OutputNode } from "../lib/render";
import { runPhasedRender } from "../lib/render";
import { type RepoStatus, gatherWorkspaceSummary } from "../lib/status";
import { fetchSuffix, parallelFetch, reportFetchFailures } from "../lib/sync";
import { error, isTTY, listenForAbortKeypress, stderr } from "../lib/terminal";
import { workspaceBranch, workspaceRepoDirs } from "../lib/workspace";
import { requireWorkspace } from "../lib/workspace";
import { registerBranchRenameSubcommand } from "./branch-rename";

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

function buildBranchSummaryNodes(branch: string, base: string | null, repos: RepoBranch[]): OutputNode[] {
	const baseDisplay = base ?? "(default branch)";
	const nodes: OutputNode[] = [
		{
			kind: "table",
			columns: [
				{ header: "BRANCH", key: "branch" },
				{ header: "BASE", key: "base" },
			],
			rows: [
				{
					cells: {
						branch: cell(branch),
						base: cell(baseDisplay, base ? "default" : "muted"),
					},
				},
			],
		},
	];

	// Per-repo deviations
	const deviations = repos.filter((r) => r.branch !== branch);
	if (deviations.length > 0) {
		nodes.push(
			{ kind: "gap" },
			{
				kind: "section",
				header: cell("Repos on a different branch:", "attention"),
				items: deviations.map((r) => {
					const label = r.branch === null ? "(detached)" : r.branch;
					return cell(`${r.name}    ${label}`);
				}),
			},
		);
	}

	return nodes;
}

function buildVerboseNodes(repos: RepoStatus[], branch: string, base: string | null): OutputNode[] {
	const baseDisplay = base ?? "(default branch)";
	const nodes: OutputNode[] = [
		{
			kind: "table",
			columns: [
				{ header: "BRANCH", key: "branch" },
				{ header: "BASE", key: "base" },
			],
			rows: [
				{
					cells: {
						branch: cell(branch),
						base: cell(baseDisplay, base ? "default" : "muted"),
					},
				},
			],
		},
		{ kind: "gap" },
	];

	// Per-repo table
	const verboseRows = buildVerboseRows(repos, branch);
	nodes.push({
		kind: "table",
		columns: [
			{ header: "REPO", key: "repo" },
			{ header: "BRANCH", key: "branch" },
			{ header: "BASE", key: "base" },
			{ header: "SHARE", key: "share" },
		],
		rows: verboseRows.map((row) => ({
			cells: {
				repo: cell(row.name),
				branch: cell(row.branch, row.branchNoteworthy ? "attention" : "default"),
				base: cell(row.base),
				share: cell(row.share),
			},
		})),
	});

	return nodes;
}

export function registerBranchCommand(program: Command, getCtx: () => ArbContext): void {
	const branch = program
		.command("branch")
		.summary("Inspect and rename the workspace branch")
		.description("Inspect or rename the workspace branch. When invoked without a subcommand, defaults to 'show'.");

	branch
		.command("show", { isDefault: true })
		.option("-q, --quiet", "Output just the branch name")
		.option("-v, --verbose", "Show per-repo branch and remote tracking detail")
		.option("--fetch", "Fetch remotes before displaying (default in verbose mode)")
		.option("-N, --no-fetch", "Skip fetching")
		.option("--json", "Output structured JSON")
		.option("--schema", "Print JSON Schema for this command's --json output and exit")
		.summary("Show the workspace branch (default)")
		.description(
			"Show the workspace branch, base branch (if configured), and any per-repo deviations. Use --verbose to show a per-repo table with branch and remote tracking info (fetches by default; use -N to skip). Press Escape during the fetch to cancel and use stale data. Use --quiet to output just the branch name (useful for scripting). Use --json for machine-readable output.\n\nSee 'arb help scripting' for output modes and piping.",
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

	registerBranchRenameSubcommand(branch, getCtx);
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
			const result = await git(dir, "symbolic-ref", "--short", "HEAD");
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
	const nodes = buildBranchSummaryNodes(branch, base, repos);
	const rCtx: RenderContext = { tty: isTTY() };
	process.stdout.write(render(nodes, rCtx));
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
	await assertMinimumGitVersion(cache);
	const repoDirs = workspaceRepoDirs(wsDir);

	if (options.fetch !== false && !options.json && isTTY()) {
		// Phased rendering: stale → fetch → fresh
		const repoNames = repoDirs.map((d) => basename(d));
		const { signal: abortSignal, cleanup: abortCleanup } = listenForAbortKeypress();
		const fetchPromise = cache
			.resolveRemotesMap(repoNames, ctx.reposDir)
			.then((remotesMap) => parallelFetch(repoDirs, undefined, remotesMap, { silent: true, signal: abortSignal }));
		fetchPromise.catch(() => {}); // Prevent unhandled rejection on abort

		const state: {
			fetchResults?: Map<string, { exitCode: number; output: string }>;
			aborted?: boolean;
			staleOutput?: string;
		} = {};

		try {
			await runPhasedRender([
				{
					render: async () => {
						const summary = await gatherWorkspaceSummary(wsDir, ctx.reposDir, undefined, cache);
						state.staleOutput = formatVerboseOutput(summary.repos, branch, base);
						return state.staleOutput + fetchSuffix(repoNames.length, { abortable: true });
					},
					write: stderr,
				},
				{
					render: async () => {
						if (abortSignal.aborted) {
							state.aborted = true;
							return state.staleOutput as string;
						}
						state.fetchResults = await fetchPromise;
						if (abortSignal.aborted) {
							state.aborted = true;
							return state.staleOutput as string;
						}
						cache.invalidateAfterFetch();
						const summary = await gatherWorkspaceSummary(wsDir, ctx.reposDir, undefined, cache);
						return formatVerboseOutput(summary.repos, branch, base);
					},
					write: (output) => process.stdout.write(output),
				},
			]);
		} finally {
			abortCleanup();
		}
		if (!state.aborted) {
			reportFetchFailures(repoNames, state.fetchResults as Map<string, { exitCode: number; output: string }>);
		}
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

	process.stdout.write(formatVerboseOutput(summary.repos, branch, base));
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

function formatVerboseOutput(repos: RepoStatus[], branch: string, base: string | null): string {
	const nodes = buildVerboseNodes(repos, branch, base);
	const rCtx: RenderContext = { tty: isTTY() };
	return render(nodes, rCtx);
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
