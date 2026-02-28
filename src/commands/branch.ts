import { basename } from "node:path";
import type { Command } from "commander";
import { configGet } from "../lib/config";
import { ArbError } from "../lib/errors";
import { git } from "../lib/git";
import { printSchema } from "../lib/json-schema";
import { type BranchJsonOutput, BranchJsonOutputSchema } from "../lib/json-types";
import { dim, error, yellow } from "../lib/output";
import { workspaceRepoDirs } from "../lib/repos";
import { ITEM_INDENT, SECTION_INDENT } from "../lib/status-verbose";
import type { ArbContext } from "../lib/types";
import { workspaceBranch } from "../lib/workspace-branch";
import { requireWorkspace } from "../lib/workspace-context";

interface RepoBranch {
	name: string;
	branch: string | null;
}

export function registerBranchCommand(program: Command, getCtx: () => ArbContext): void {
	program
		.command("branch")
		.option("-q, --quiet", "Output just the branch name")
		.option("--json", "Output structured JSON")
		.option("--schema", "Print JSON Schema for this command's --json output and exit")
		.summary("Show the workspace branch")
		.description(
			"Show the workspace branch, base branch (if configured), and any per-repo deviations. Use --quiet to output just the branch name (useful for scripting). Use --json for machine-readable output.",
		)
		.action(async (options: { quiet?: boolean; json?: boolean; schema?: boolean }) => {
			if (options.schema) {
				if (options.json || options.quiet) {
					error("Cannot combine --schema with --json or --quiet.");
					throw new ArbError("Cannot combine --schema with --json or --quiet.");
				}
				printSchema(BranchJsonOutputSchema);
				return;
			}
			const ctx = getCtx();
			requireWorkspace(ctx);
			await runBranch(ctx, options);
		});
}

async function runBranch(ctx: ArbContext, options: { quiet?: boolean; json?: boolean }): Promise<void> {
	const wsDir = `${ctx.arbRootDir}/${ctx.currentWorkspace}`;
	const configFile = `${wsDir}/.arbws/config`;

	if (options.quiet && options.json) {
		error("Cannot combine --quiet with --json.");
		throw new ArbError("Cannot combine --quiet with --json.");
	}

	const wb = await workspaceBranch(wsDir);
	const branch = wb?.branch ?? (ctx.currentWorkspace as string);
	const base = configGet(configFile, "base");

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
	const showBase = base !== null;
	const branchColWidth = Math.max(6, branch.length); // at least "BRANCH" header width
	const gap = 8;
	let header = `  ${dim("BRANCH")}${" ".repeat(branchColWidth - 6)}`;
	if (showBase) {
		header += `${" ".repeat(gap)}${dim("BASE")}`;
	}
	let output = `${header}\n`;
	output += `  ${branch}`;
	if (showBase) {
		const pad = branchColWidth - branch.length + gap;
		output += `${" ".repeat(pad)}${base}`;
	}
	output += "\n";

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
