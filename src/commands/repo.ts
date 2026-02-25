import { existsSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import type { Command } from "commander";
import { git } from "../lib/git";
import type { RepoListJsonEntry } from "../lib/json-types";
import { confirmOrExit } from "../lib/mutation-flow";
import { dim, error, info, inlineResult, inlineStart, plural, success, yellow } from "../lib/output";
import { getRemoteUrl, resolveRemotes } from "../lib/remotes";
import { findRepoUsage, listRepos, selectInteractive } from "../lib/repos";
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

			await git(target, "checkout", "--detach");

			if (options.upstream) {
				// Add upstream remote
				const addResult = await git(target, "remote", "add", "upstream", options.upstream);
				if (addResult.exitCode !== 0) {
					error(`Failed to add upstream remote: ${addResult.stderr.trim()}`);
					process.exit(1);
				}

				// Set remote.pushDefault so resolveRemotes() detects the fork layout
				await git(target, "config", "remote.pushDefault", "origin");

				// Fetch upstream and auto-detect HEAD
				const fetchResult = await git(target, "fetch", "upstream");
				if (fetchResult.exitCode !== 0) {
					error(`Failed to fetch upstream: ${fetchResult.stderr.trim()}`);
					process.exit(1);
				}
				await git(target, "remote", "set-head", "upstream", "--auto");

				info(`  share: origin (${url})`);
				info(`  base:  upstream (${options.upstream})`);
				success(`Cloned repo ${repoName}`);
			} else {
				success(`Cloned repo ${repoName}`);
			}
		});

	// ── repo list ───────────────────────────────────────────────────

	repo
		.command("list")
		.option("-q, --quiet", "Output one repo name per line")
		.option("-v, --verbose", "Show remote URLs alongside names")
		.option("--json", "Output structured JSON")
		.summary("List cloned repos")
		.description(
			"List all repositories that have been cloned into .arb/repos/. Shows resolved SHARE and BASE remote names for each repo. Use --verbose to include remote URLs alongside names. Use --quiet for plain enumeration (one name per line). Use --json for machine-readable output.",
		)
		.action(async (options: { quiet?: boolean; verbose?: boolean; json?: boolean }) => {
			const ctx = getCtx();

			if (options.quiet && options.json) {
				error("Cannot combine --quiet with --json.");
				process.exit(1);
			}
			if (options.quiet && options.verbose) {
				error("Cannot combine --quiet with --verbose.");
				process.exit(1);
			}
			if (options.verbose && options.json) {
				error("Cannot combine --verbose with --json.");
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
				let shareName = "";
				let shareUrl = "";
				let baseName = "";
				let baseUrl = "";
				try {
					const remotes = await resolveRemotes(repoDir);
					shareName = remotes.share;
					baseName = remotes.base;
					const [sUrl, bUrl] = await Promise.all([
						getRemoteUrl(repoDir, remotes.share),
						getRemoteUrl(repoDir, remotes.base),
					]);
					shareUrl = sUrl ?? "";
					baseUrl = bUrl ?? "";
				} catch {
					// Ambiguous remotes — fall back to origin URL with warning
					const url = await getRemoteUrl(repoDir, "origin");
					shareUrl = url ?? "";
					baseUrl = url ?? "";
				}
				entries.push({
					name: r,
					url: shareUrl,
					share: { name: shareName, url: shareUrl },
					base: { name: baseName, url: baseUrl },
				});
			}

			// JSON output
			if (options.json) {
				process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
				return;
			}

			const maxRepo = Math.max(4, ...entries.map((e) => e.name.length));

			if (options.verbose) {
				const basePlain = entries.map((e) =>
					e.base.name ? `${e.base.name} (${e.base.url})` : "(remotes not resolved)",
				);
				const baseDisplay = basePlain.map((v, i) => (entries[i]?.base.name ? v : yellow(v)));
				const maxBase = Math.max(4, ...basePlain.map((v) => v.length));

				process.stdout.write(
					`  ${dim("REPO")}${" ".repeat(maxRepo - 4)}    ${dim("BASE")}${" ".repeat(maxBase - 4)}    ${dim("SHARE")}\n`,
				);
				for (const [i, e] of entries.entries()) {
					const base = baseDisplay[i] ?? yellow("(remotes not resolved)");
					const basePad = " ".repeat(Math.max(0, maxBase - (basePlain[i]?.length ?? 0)));
					const shareDisplay =
						!e.share.name && !e.base.name
							? yellow("(remotes not resolved)")
							: e.share.name === e.base.name
								? e.share.name
								: `${e.share.name} (${e.share.url})`;
					process.stdout.write(`  ${e.name.padEnd(maxRepo)}    ${base}${basePad}    ${shareDisplay}\n`);
				}
			} else {
				const maxBase = Math.max(4, ...entries.map((e) => (e.base.name || "(remotes not resolved)").length));

				process.stdout.write(
					`  ${dim("REPO")}${" ".repeat(maxRepo - 4)}    ${dim("BASE")}${" ".repeat(maxBase - 4)}    ${dim("SHARE")}\n`,
				);
				for (const e of entries) {
					const basePlain = e.base.name || "(remotes not resolved)";
					const baseCol = e.base.name ? basePlain : yellow(basePlain);
					const basePad = " ".repeat(Math.max(0, maxBase - basePlain.length));
					const shareDisplay = !e.share.name && !e.base.name ? yellow("(remotes not resolved)") : e.share.name;
					process.stdout.write(`  ${e.name.padEnd(maxRepo)}    ${baseCol}${basePad}    ${shareDisplay}\n`);
				}
			}
		});

	// ── repo remove ────────────────────────────────────────────────

	repo
		.command("remove [names...]")
		.option("-a, --all-repos", "Remove all canonical repos")
		.option("-y, --yes", "Skip confirmation prompt")
		.summary("Remove canonical repos from .arb/repos/")
		.description(
			"Remove one or more canonical repository clones from .arb/repos/ and their associated template files from .arb/templates/repos/. This is the inverse of 'arb repo clone'.\n\nRefuses to remove repos that are attached to a workspace. Run 'arb detach <repo>' or 'arb delete <workspace>' first, then retry. Prompts with a repo picker when run without arguments.",
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
				if (!process.stdin.isTTY) {
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
				const usedBy = findRepoUsage(ctx.arbRootDir, name);
				if (usedBy.length > 0) {
					error(
						`Cannot remove ${name} — used by ${usedBy.length === 1 ? "workspace" : "workspaces"}: ${usedBy.join(", ")}`,
					);
					info(`  Run 'arb detach ${name}' in each workspace, or 'arb delete <workspace>' first.`);
					process.exit(1);
				}
			}

			// Display plan
			process.stderr.write("\n");
			for (const name of repos) {
				const repoDir = `${ctx.reposDir}/${name}`;
				const url = await getRemoteUrl(repoDir, "origin");
				info(`  ${name}${url ? `  ${dim(url)}` : ""}`);
			}
			process.stderr.write("\n");

			// Confirm
			await confirmOrExit({ yes: options.yes, message: `Remove ${plural(repos.length, "repo")}?` });

			// Execute
			process.stderr.write("\n");
			for (const name of repos) {
				inlineStart(name, "removing");
				rmSync(`${ctx.reposDir}/${name}`, { recursive: true, force: true });
				const templateDir = join(ctx.arbRootDir, ".arb", "templates", "repos", name);
				if (existsSync(templateDir)) {
					rmSync(templateDir, { recursive: true, force: true });
				}
				inlineResult(name, "removed");
			}

			// Summarize
			process.stderr.write("\n");
			success(`Removed ${plural(repos.length, "repo")}`);
		});
}
