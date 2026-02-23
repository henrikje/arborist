import { existsSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import confirm from "@inquirer/confirm";
import type { Command } from "commander";
import type { RepoListJsonEntry } from "../lib/json-types";
import { dim, error, info, plural, skipConfirmNotice, success, yellow } from "../lib/output";
import { getRemoteUrl, resolveRemotes } from "../lib/remotes";
import { findRepoUsage, listRepos, selectInteractive } from "../lib/repos";
import { isTTY } from "../lib/tty";
import type { ArbContext } from "../lib/types";

export function registerRepoCommand(program: Command, getCtx: () => ArbContext): void {
	const repo = program
		.command("repo")
		.summary("Manage canonical repos")
		.description(
			"Manage the canonical repository clones in .arb/repos/. These permanent clones are never worked in directly — instead, arb creates worktrees that point back to them. Use subcommands to clone new repos, list existing ones, or remove repos that are no longer needed.",
		);

	// ── repo clone ──────────────────────────────────────────────────

	repo
		.command("clone <url> [name]")
		.option("--upstream <url>", "Add an upstream remote (for fork workflows)")
		.summary("Clone a repo into .arb/repos/")
		.description(
			"Clone a git repository into .arb/repos/<name> as a canonical copy. These permanent clones are never worked in directly — instead, arb creates worktrees that point back to them. The repo name is derived from the URL if not specified.\n\nFor fork workflows, use --upstream to add the canonical repo as an upstream remote. This sets remote.pushDefault so arb knows to push to origin (your fork) and rebase from upstream.",
		)
		.action(async (url: string, nameArg: string | undefined, options: { upstream?: string }) => {
			const ctx = getCtx();
			const repoName = nameArg || basename(url).replace(/\.git$/, "");

			if (!repoName) {
				error("Could not derive repo name from URL. Specify one: arb repo clone <url> <name>");
				process.exit(1);
			}

			const target = `${ctx.reposDir}/${repoName}`;
			if (existsSync(target)) {
				error(`${repoName} is already cloned`);
				process.exit(1);
			}

			const result = await Bun.$`git clone ${url} ${target}`.cwd(ctx.reposDir).quiet().nothrow();
			if (result.exitCode !== 0) {
				error(`Clone failed: ${result.stderr.toString().trim()}`);
				process.exit(1);
			}

			await Bun.$`git -C ${target} checkout --detach`.cwd(target).quiet().nothrow();

			if (options.upstream) {
				// Add upstream remote
				const addResult = await Bun.$`git -C ${target} remote add upstream ${options.upstream}`
					.cwd(target)
					.quiet()
					.nothrow();
				if (addResult.exitCode !== 0) {
					error(`Failed to add upstream remote: ${addResult.stderr.toString().trim()}`);
					process.exit(1);
				}

				// Set remote.pushDefault so resolveRemotes() detects the fork layout
				await Bun.$`git -C ${target} config remote.pushDefault origin`.cwd(target).quiet().nothrow();

				// Fetch upstream and auto-detect HEAD
				const fetchResult = await Bun.$`git -C ${target} fetch upstream`.cwd(target).quiet().nothrow();
				if (fetchResult.exitCode !== 0) {
					error(`Failed to fetch upstream: ${fetchResult.stderr.toString().trim()}`);
					process.exit(1);
				}
				await Bun.$`git -C ${target} remote set-head upstream --auto`.cwd(target).quiet().nothrow();

				info(`  share:    origin (${url})`);
				info(`  upstream: upstream (${options.upstream})`);
				success(`Cloned repo ${repoName}`);
			} else {
				success(`Cloned repo ${repoName}`);
			}
		});

	// ── repo list ───────────────────────────────────────────────────

	repo
		.command("list")
		.option("-q, --quiet", "Output one repo name per line")
		.option("--json", "Output structured JSON")
		.summary("List cloned repos")
		.description(
			"List all repositories that have been cloned into .arb/repos/. These are the canonical clones that workspaces create worktrees from. Use --quiet for plain enumeration (one name per line). Use --json for machine-readable output.",
		)
		.action(async (options: { quiet?: boolean; json?: boolean }) => {
			const ctx = getCtx();

			if (options.quiet && options.json) {
				process.stderr.write("Cannot combine --quiet with --json.\n");
				process.exit(1);
			}

			const repos = listRepos(ctx.reposDir);
			if (repos.length === 0) return;

			// Quiet output — skip URL resolution for speed
			if (options.quiet) {
				for (const r of repos) {
					process.stdout.write(`${r}\n`);
				}
				return;
			}

			const entries: RepoListJsonEntry[] = [];
			for (const r of repos) {
				const repoDir = `${ctx.reposDir}/${r}`;
				let url: string | null = null;
				try {
					const remotes = await resolveRemotes(repoDir);
					url = await getRemoteUrl(repoDir, remotes.share);
				} catch {
					// Ambiguous remotes — fall back to showing origin URL
					url = await getRemoteUrl(repoDir, "origin");
				}
				entries.push({ name: r, url: url ?? "" });
			}

			// JSON output
			if (options.json) {
				process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
				return;
			}

			const maxRepo = Math.max(4, ...entries.map((e) => e.name.length));

			process.stdout.write(`  ${dim("REPO")}${" ".repeat(maxRepo - 4)}    ${dim("URL")}\n`);
			for (const { name, url } of entries) {
				const urlDisplay = url || yellow("(remotes not resolved)");
				process.stdout.write(`  ${name.padEnd(maxRepo)}    ${urlDisplay}\n`);
			}
		});

	// ── repo remove ────────────────────────────────────────────────

	repo
		.command("remove [names...]")
		.option("-a, --all-repos", "Remove all canonical repos")
		.option("-y, --yes", "Skip confirmation prompt")
		.summary("Remove canonical repos from .arb/repos/")
		.description(
			"Remove one or more canonical repository clones from .arb/repos/ and their associated template files from .arb/templates/repos/. This is the inverse of 'arb repo clone'.\n\nRefuses to remove repos that have worktrees in any workspace. Run 'arb drop <repo>' or 'arb remove <workspace>' first, then retry. Prompts with a repo picker when run without arguments.",
		)
		.action(async (nameArgs: string[], options: { allRepos?: boolean; yes?: boolean }) => {
			const ctx = getCtx();
			const allRepos = listRepos(ctx.reposDir);

			let repos = nameArgs;
			if (options.allRepos) {
				if (allRepos.length === 0) {
					error("No repos to remove.");
					process.exit(1);
				}
				repos = allRepos;
			} else if (repos.length === 0) {
				if (!isTTY()) {
					error("No repos specified. Pass repo names or use --all-repos.");
					process.exit(1);
				}
				if (allRepos.length === 0) {
					error("No repos to remove.");
					process.exit(1);
				}
				repos = await selectInteractive(allRepos, "Select repos to remove");
				if (repos.length === 0) {
					error("No repos selected.");
					process.exit(1);
				}
			}

			// Validate all repos exist
			for (const name of repos) {
				if (!allRepos.includes(name)) {
					error(`Repo '${name}' is not cloned.`);
					process.exit(1);
				}
			}

			// Check workspace usage — hard refuse if any repo is in use
			for (const name of repos) {
				const usedBy = findRepoUsage(ctx.baseDir, name);
				if (usedBy.length > 0) {
					error(
						`Cannot remove ${name} — used by ${usedBy.length === 1 ? "workspace" : "workspaces"}: ${usedBy.join(", ")}`,
					);
					info(`  Run 'arb drop ${name}' in each workspace, or 'arb remove <workspace>' first.`);
					process.exit(1);
				}
			}

			// Display plan
			for (const name of repos) {
				const repoDir = `${ctx.reposDir}/${name}`;
				const url = await getRemoteUrl(repoDir, "origin");
				info(`  ${name}${url ? `  ${dim(url)}` : ""}`);
			}
			process.stderr.write("\n");

			// Confirm
			if (!options.yes) {
				if (!isTTY()) {
					error("Not a terminal. Use --yes to skip confirmation.");
					process.exit(1);
				}
				const subject = repos.length === 1 ? `repo ${repos[0]}` : plural(repos.length, "repo");
				const shouldRemove = await confirm(
					{ message: `Remove ${subject}?`, default: false },
					{ output: process.stderr },
				);
				if (!shouldRemove) {
					process.stderr.write("Aborted.\n");
					process.exit(130);
				}
			} else {
				skipConfirmNotice("--yes");
			}

			// Execute
			for (const name of repos) {
				rmSync(`${ctx.reposDir}/${name}`, { recursive: true, force: true });
				const templateDir = join(ctx.baseDir, ".arb", "templates", "repos", name);
				if (existsSync(templateDir)) {
					rmSync(templateDir, { recursive: true, force: true });
				}
			}

			// Summarize
			if (repos.length === 1) {
				success(`Removed repo ${repos[0]}`);
			} else {
				success(`Removed ${plural(repos.length, "repo")}`);
			}
		});
}
