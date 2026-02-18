import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { Command } from "commander";
import { error, info, plural, success, yellow } from "../lib/output";
import { workspaceRepoDirs } from "../lib/repos";
import {
	type ForceOverlayResult,
	type OverlayResult,
	type TemplateDiff,
	type TemplateEntry,
	applyRepoTemplates,
	applyWorkspaceTemplates,
	detectTemplateScope,
	diffTemplates,
	forceApplyRepoTemplates,
	forceApplyWorkspaceTemplates,
	listTemplates,
	removeTemplate,
	templateFilePath,
	workspaceFilePath,
} from "../lib/templates";
import type { ArbContext } from "../lib/types";
import { requireWorkspace } from "../lib/workspace-context";

function collectRepo(value: string, previous: string[]): string[] {
	return previous.concat(value);
}

function resolveScope(
	options: { repo?: string[]; workspace?: boolean },
	ctx: ArbContext,
): { scope: "workspace" | "repo"; repos?: string[] } {
	const hasRepoFlag = options.repo && options.repo.length > 0;
	const hasWsFlag = options.workspace === true;

	if (hasRepoFlag && hasWsFlag) {
		error("Cannot use both --repo and --workspace.");
		process.exit(1);
	}

	if (hasRepoFlag) {
		return { scope: "repo", repos: options.repo };
	}

	if (hasWsFlag) {
		return { scope: "workspace" };
	}

	// Auto-detect from CWD
	const detected = detectTemplateScope(ctx.baseDir, process.cwd());
	if (!detected) {
		error("Cannot determine scope. Use --repo <name> or --workspace, or run from inside a workspace.");
		process.exit(1);
	}

	if (detected.scope === "repo" && detected.repo) {
		return { scope: "repo", repos: [detected.repo] };
	}
	return { scope: "workspace" };
}

export function registerTemplateCommand(program: Command, getCtx: () => ArbContext): void {
	const template = program
		.command("template")
		.summary("Manage workspace templates")
		.description(
			"Manage template files that are automatically seeded into new workspaces. Templates live in .arb/templates/ and are copied into workspaces during 'arb create' and 'arb add'. Use subcommands to add, remove, list, diff, and apply templates.",
		);

	// ── template add ─────────────────────────────────────────────────

	template
		.command("add <file>")
		.option("--repo <name>", "Target repo scope (repeatable)", collectRepo, [])
		.option("--workspace", "Target workspace scope")
		.option("-f, --force", "Overwrite existing template")
		.summary("Capture a file as a template")
		.description(
			"Copy a file from the current workspace into .arb/templates/. The scope (workspace or repo) is auto-detected from your current directory. Use --repo or --workspace to override. The file must exist. If the template already exists with identical content, succeeds silently. If content differs, use --force to overwrite.",
		)
		.action((file: string, options: { repo?: string[]; workspace?: boolean; force?: boolean }) => {
			const ctx = getCtx();
			const { scope, repos } = resolveScope(options, ctx);
			const srcPath = resolve(file);

			if (!existsSync(srcPath)) {
				error(`File not found: ${file}`);
				process.exit(1);
			}

			// Determine the relative path for the template
			const { wsDir } = requireWorkspace(ctx);
			let relPath: string;
			if (scope === "workspace") {
				const prefix = `${wsDir}/`;
				if (srcPath.startsWith(prefix)) {
					relPath = srcPath.slice(prefix.length);
				} else {
					relPath = basename(srcPath);
				}
			} else {
				const firstRepo = repos?.[0] ?? "";
				const repoDir = join(wsDir, firstRepo);
				const prefix = `${repoDir}/`;
				if (srcPath.startsWith(prefix)) {
					relPath = srcPath.slice(prefix.length);
				} else {
					relPath = basename(srcPath);
				}
			}

			const targetRepos: (string | undefined)[] = scope === "repo" && repos ? repos : [undefined];
			let hasConflict = false;
			for (const repo of targetRepos) {
				const templatePath = templateFilePath(ctx.baseDir, scope, relPath, repo);

				if (existsSync(templatePath)) {
					const existingContent = readFileSync(templatePath);
					const newContent = readFileSync(srcPath);
					if (existingContent.equals(newContent)) {
						info(`  Template already up to date: ${relPath}${repo ? ` (repo: ${repo})` : ""}`);
						continue;
					}
					if (!options.force) {
						error(`Template already exists: ${relPath}${repo ? ` (repo: ${repo})` : ""}. Use --force to overwrite.`);
						hasConflict = true;
						continue;
					}
					mkdirSync(dirname(templatePath), { recursive: true });
					copyFileSync(srcPath, templatePath);
					info(`  Updated template: ${relPath}${repo ? ` (repo: ${repo})` : ""}`);
				} else {
					mkdirSync(dirname(templatePath), { recursive: true });
					copyFileSync(srcPath, templatePath);
					info(`  Added template: ${relPath}${repo ? ` (repo: ${repo})` : ""}`);
				}
			}
			if (hasConflict) process.exit(1);
		});

	// ── template remove ──────────────────────────────────────────────

	template
		.command("remove <file>")
		.option("--repo <name>", "Target repo scope (repeatable)", collectRepo, [])
		.option("--workspace", "Target workspace scope")
		.summary("Remove a template file")
		.description(
			"Delete a template file from .arb/templates/. Scope is auto-detected from your current directory. Use --repo or --workspace to override. Does not delete seeded copies in existing workspaces.",
		)
		.action((file: string, options: { repo?: string[]; workspace?: boolean }) => {
			const ctx = getCtx();
			const { scope, repos } = resolveScope(options, ctx);

			const targetRepos: (string | undefined)[] = scope === "repo" && repos ? repos : [undefined];
			for (const repo of targetRepos) {
				try {
					removeTemplate(ctx.baseDir, scope, file, repo);
					info(`  Removed template: ${file}${repo ? ` (repo: ${repo})` : ""}`);
				} catch (e) {
					error(e instanceof Error ? e.message : String(e));
					process.exit(1);
				}
			}
		});

	// ── template list ────────────────────────────────────────────────

	template
		.command("list")
		.summary("List all defined templates")
		.description(
			"Show all template files in .arb/templates/. When run inside a workspace, annotates files that differ from their seeded copy with (modified).",
		)
		.action(() => {
			const ctx = getCtx();
			const templates = listTemplates(ctx.baseDir);

			if (templates.length === 0) {
				info("  No templates defined.");
				return;
			}

			// Check for drift annotations if inside a workspace
			let diffs: TemplateDiff[] = [];
			if (ctx.currentWorkspace) {
				const wsDir = `${ctx.baseDir}/${ctx.currentWorkspace}`;
				if (existsSync(join(wsDir, ".arbws"))) {
					const repos = workspaceRepoDirs(wsDir).map((d) => basename(d));
					diffs = diffTemplates(ctx.baseDir, wsDir, repos);
				}
			}

			const diffSet = new Set(diffs.map((d) => `${d.scope}:${d.repo ?? ""}:${d.relPath}`));

			// Compute column widths
			let maxScope = 0;
			let maxPath = 0;
			for (const t of templates) {
				const scopeLabel = t.scope === "workspace" ? "workspace" : (t.repo ?? "");
				if (scopeLabel.length > maxScope) maxScope = scopeLabel.length;
				if (t.relPath.length > maxPath) maxPath = t.relPath.length;
			}

			for (const t of templates) {
				const scopeLabel = t.scope === "workspace" ? "workspace" : (t.repo ?? "");
				const key = `${t.scope}:${t.repo ?? ""}:${t.relPath}`;
				const modified = diffSet.has(key);
				const padded = t.relPath.padEnd(maxPath);
				const annotation = modified ? `  ${yellow("(modified)")}` : "";
				process.stderr.write(`  [${scopeLabel}]${" ".repeat(maxScope - scopeLabel.length)} ${padded}${annotation}\n`);
			}
		});

	// ── template diff ────────────────────────────────────────────────

	template
		.command("diff [file]")
		.option("--repo <name>", "Filter to specific repo (repeatable)", collectRepo, [])
		.option("--workspace", "Filter to workspace templates only")
		.summary("Show template drift (unified diff)")
		.description(
			"Show content differences between templates and their workspace copies. Generates unified diff output for each drifted file. Exits with code 1 if any drift is found (useful for CI). Use --repo or --workspace to filter scope, and optionally specify a file path to diff only that template.",
		)
		.action((file: string | undefined, options: { repo?: string[]; workspace?: boolean }) => {
			const ctx = getCtx();
			const { wsDir } = requireWorkspace(ctx);
			const repos = workspaceRepoDirs(wsDir).map((d) => basename(d));
			let diffs = diffTemplates(ctx.baseDir, wsDir, repos);

			// Filter by scope flags
			const hasRepoFlag = options.repo && options.repo.length > 0;
			const hasWsFlag = options.workspace === true;

			if (hasRepoFlag && !hasWsFlag) {
				const repoSet = new Set(options.repo);
				diffs = diffs.filter((d) => d.scope === "repo" && d.repo !== undefined && repoSet.has(d.repo));
			} else if (hasWsFlag && !hasRepoFlag) {
				diffs = diffs.filter((d) => d.scope === "workspace");
			} else if (hasRepoFlag && hasWsFlag) {
				const repoSet = new Set(options.repo);
				diffs = diffs.filter(
					(d) => d.scope === "workspace" || (d.scope === "repo" && d.repo !== undefined && repoSet.has(d.repo)),
				);
			}

			// Filter by file path
			if (file) {
				diffs = diffs.filter((d) => d.relPath === file);
			}

			if (diffs.length === 0) {
				info("  No changes.");
				return;
			}

			for (const diff of diffs) {
				const tplPath = templateFilePath(ctx.baseDir, diff.scope, diff.relPath, diff.repo);
				const wsPath = workspaceFilePath(wsDir, diff.scope, diff.relPath, diff.repo);

				const tplLabel =
					diff.scope === "workspace"
						? `.arb/templates/workspace/${diff.relPath}`
						: `.arb/templates/repos/${diff.repo}/${diff.relPath}`;
				const wsLabel = diff.scope === "workspace" ? diff.relPath : `${diff.repo}/${diff.relPath}`;

				// Generate diff using system diff command
				const proc = Bun.spawnSync([
					"diff",
					"-u",
					"--label",
					`${tplLabel} (template)`,
					"--label",
					`${wsLabel} (workspace)`,
					tplPath,
					wsPath,
				]);
				const output = proc.stdout.toString();
				if (output) {
					process.stderr.write(`${output}\n`);
				}
			}

			process.exit(1);
		});

	// ── template apply ───────────────────────────────────────────────

	template
		.command("apply [file]")
		.option("--repo <name>", "Apply only to specific repo (repeatable)", collectRepo, [])
		.option("--workspace", "Apply only workspace templates")
		.option("-f, --force", "Overwrite drifted files (reset to template version)")
		.summary("Re-seed templates into the current workspace")
		.description(
			"Re-seed template files into the current workspace. By default, only copies files that don't already exist (safe, non-destructive). Use --force to also reset drifted files to their template version. Use --repo or --workspace to limit scope, and optionally specify a file path to apply only that template.",
		)
		.action((file: string | undefined, options: { repo?: string[]; workspace?: boolean; force?: boolean }) => {
			const ctx = getCtx();
			const { wsDir } = requireWorkspace(ctx);
			const allRepos = workspaceRepoDirs(wsDir).map((d) => basename(d));

			const hasRepoFlag = options.repo && options.repo.length > 0;
			const hasWsFlag = options.workspace === true;

			// Determine which scopes to apply
			const applyWorkspace = hasWsFlag || (!hasRepoFlag && !hasWsFlag);
			const reposToApply = hasRepoFlag && options.repo ? options.repo : !hasWsFlag ? allRepos : [];

			if (options.force) {
				applyForceMode(ctx, wsDir, applyWorkspace, reposToApply, file);
			} else {
				applyDefaultMode(ctx, wsDir, applyWorkspace, reposToApply, file);
			}
		});
}

function resolveTemplatesToApply(
	ctx: ArbContext,
	applyWorkspace: boolean,
	repos: string[],
	fileFilter?: string,
): TemplateEntry[] {
	if (fileFilter) {
		// When filtering by file, enumerate matching templates only
		const all = listTemplates(ctx.baseDir);
		return all.filter((t) => {
			if (t.relPath !== fileFilter) return false;
			if (t.scope === "workspace") return applyWorkspace;
			return repos.includes(t.repo ?? "");
		});
	}
	// No filter — use full overlay mode (handled separately)
	return [];
}

function applySingleFile(
	tplPath: string,
	destPath: string,
	force: boolean,
): { status: "seeded" | "skipped" | "reset" | "unchanged" } {
	if (!existsSync(destPath)) {
		mkdirSync(dirname(destPath), { recursive: true });
		copyFileSync(tplPath, destPath);
		return { status: "seeded" };
	}
	if (!force) {
		return { status: "skipped" };
	}
	const srcContent = readFileSync(tplPath);
	const destContent = readFileSync(destPath);
	if (srcContent.equals(destContent)) {
		return { status: "unchanged" };
	}
	copyFileSync(tplPath, destPath);
	return { status: "reset" };
}

function applyDefaultMode(
	ctx: ArbContext,
	wsDir: string,
	applyWorkspace: boolean,
	repos: string[],
	fileFilter?: string,
): void {
	let totalSeeded = 0;
	let totalSkipped = 0;

	if (fileFilter) {
		const entries = resolveTemplatesToApply(ctx, applyWorkspace, repos, fileFilter);
		for (const entry of entries) {
			const tplPath = templateFilePath(ctx.baseDir, entry.scope, entry.relPath, entry.repo);
			const destPath = workspaceFilePath(wsDir, entry.scope, entry.relPath, entry.repo);
			const scope = entry.scope === "workspace" ? "workspace" : (entry.repo ?? "");
			const { status } = applySingleFile(tplPath, destPath, false);
			const label = status === "skipped" ? yellow("skipped (exists)") : "seeded";
			process.stderr.write(`  [${scope}] ${entry.relPath.padEnd(40)} ${label}\n`);
			if (status === "seeded") totalSeeded++;
			else totalSkipped++;
		}
	} else {
		if (applyWorkspace) {
			const result = applyWorkspaceTemplates(ctx.baseDir, wsDir);
			displayOverlayResults(result, "workspace");
			totalSeeded += result.seeded.length;
			totalSkipped += result.skipped.length;
		}
		for (const repo of repos) {
			const result = applyRepoTemplates(ctx.baseDir, wsDir, [repo]);
			displayOverlayResults(result, repo);
			totalSeeded += result.seeded.length;
			totalSkipped += result.skipped.length;
		}
	}

	process.stderr.write("\n");
	const parts: string[] = [];
	if (totalSeeded > 0) parts.push(`Seeded ${plural(totalSeeded, "template file")}`);
	if (totalSkipped > 0) parts.push(`${totalSkipped} already present`);
	if (parts.length === 0) parts.push("No templates to apply");
	success(parts.join(", "));
}

function applyForceMode(
	ctx: ArbContext,
	wsDir: string,
	applyWorkspace: boolean,
	repos: string[],
	fileFilter?: string,
): void {
	let totalSeeded = 0;
	let totalReset = 0;
	let totalUnchanged = 0;

	if (fileFilter) {
		const entries = resolveTemplatesToApply(ctx, applyWorkspace, repos, fileFilter);
		for (const entry of entries) {
			const tplPath = templateFilePath(ctx.baseDir, entry.scope, entry.relPath, entry.repo);
			const destPath = workspaceFilePath(wsDir, entry.scope, entry.relPath, entry.repo);
			const scope = entry.scope === "workspace" ? "workspace" : (entry.repo ?? "");
			const { status } = applySingleFile(tplPath, destPath, true);
			process.stderr.write(`  [${scope}] ${entry.relPath.padEnd(40)} ${status}\n`);
			if (status === "seeded") totalSeeded++;
			else if (status === "reset") totalReset++;
			else totalUnchanged++;
		}
	} else {
		if (applyWorkspace) {
			const result = forceApplyWorkspaceTemplates(ctx.baseDir, wsDir);
			displayForceOverlayResults(result, "workspace");
			totalSeeded += result.seeded.length;
			totalReset += result.reset.length;
			totalUnchanged += result.unchanged.length;
		}
		for (const repo of repos) {
			const result = forceApplyRepoTemplates(ctx.baseDir, wsDir, [repo]);
			displayForceOverlayResults(result, repo);
			totalSeeded += result.seeded.length;
			totalReset += result.reset.length;
			totalUnchanged += result.unchanged.length;
		}
	}

	process.stderr.write("\n");
	const parts: string[] = [];
	if (totalSeeded > 0) parts.push(`Seeded ${plural(totalSeeded, "template file")}`);
	if (totalReset > 0) parts.push(`reset ${totalReset}`);
	if (totalUnchanged > 0) parts.push(`${totalUnchanged} unchanged`);
	if (parts.length === 0) parts.push("No templates to apply");
	success(parts.join(", "));
}

function displayOverlayResults(result: OverlayResult, scope: string): void {
	for (const f of result.seeded) {
		process.stderr.write(`  [${scope}] ${f.padEnd(40)} seeded\n`);
	}
	for (const f of result.skipped) {
		process.stderr.write(`  [${scope}] ${f.padEnd(40)} ${yellow("skipped (exists)")}\n`);
	}
}

function displayForceOverlayResults(result: ForceOverlayResult, scope: string): void {
	for (const f of result.seeded) {
		process.stderr.write(`  [${scope}] ${f.padEnd(40)} seeded\n`);
	}
	for (const f of result.reset) {
		process.stderr.write(`  [${scope}] ${f.padEnd(40)} reset\n`);
	}
	for (const f of result.unchanged) {
		process.stderr.write(`  [${scope}] ${f.padEnd(40)} unchanged\n`);
	}
}
