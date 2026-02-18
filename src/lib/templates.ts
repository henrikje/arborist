import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmdirSync,
	unlinkSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

export interface FailedCopy {
	path: string;
	error: string;
}

export interface OverlayResult {
	seeded: string[];
	skipped: string[];
	failed: FailedCopy[];
}

function emptyResult(): OverlayResult {
	return { seeded: [], skipped: [], failed: [] };
}

export function overlayDirectory(srcDir: string, destDir: string): OverlayResult {
	if (!existsSync(srcDir)) return emptyResult();

	const result = emptyResult();

	function walk(dir: string): void {
		for (const entry of readdirSync(dir)) {
			const srcPath = join(dir, entry);
			const stat = lstatSync(srcPath);

			if (stat.isSymbolicLink()) continue;

			if (stat.isDirectory()) {
				walk(srcPath);
			} else if (stat.isFile()) {
				const relPath = relative(srcDir, srcPath);
				const destPath = join(destDir, relPath);

				if (existsSync(destPath)) {
					result.skipped.push(relPath);
				} else {
					try {
						mkdirSync(join(destDir, relative(srcDir, dir)), { recursive: true });
						copyFileSync(srcPath, destPath);
						result.seeded.push(relPath);
					} catch (e) {
						const msg = e instanceof Error ? e.message : String(e);
						result.failed.push({ path: relPath, error: msg });
					}
				}
			}
		}
	}

	walk(srcDir);
	return result;
}

export function applyWorkspaceTemplates(baseDir: string, wsDir: string): OverlayResult {
	const templateDir = join(baseDir, ".arb", "templates", "workspace");
	return overlayDirectory(templateDir, wsDir);
}

export function applyRepoTemplates(baseDir: string, wsDir: string, repos: string[]): OverlayResult {
	const result = emptyResult();

	for (const repo of repos) {
		const templateDir = join(baseDir, ".arb", "templates", "repos", repo);
		const repoDir = join(wsDir, repo);

		if (!existsSync(templateDir) || !existsSync(repoDir)) continue;

		const repoResult = overlayDirectory(templateDir, repoDir);
		result.seeded.push(...repoResult.seeded);
		result.skipped.push(...repoResult.skipped);
		result.failed.push(...repoResult.failed);
	}

	return result;
}

export interface TemplateDiff {
	relPath: string;
	scope: "workspace" | "repo";
	repo?: string;
}

function diffDirectory(srcDir: string, destDir: string): string[] {
	if (!existsSync(srcDir)) return [];

	const diffs: string[] = [];

	function walk(dir: string): void {
		for (const entry of readdirSync(dir)) {
			const srcPath = join(dir, entry);
			const stat = lstatSync(srcPath);

			if (stat.isSymbolicLink()) continue;

			if (stat.isDirectory()) {
				walk(srcPath);
			} else if (stat.isFile()) {
				const relPath = relative(srcDir, srcPath);
				const destPath = join(destDir, relPath);

				if (!existsSync(destPath)) continue;

				const srcContent = readFileSync(srcPath);
				const destContent = readFileSync(destPath);
				if (!srcContent.equals(destContent)) {
					diffs.push(relPath);
				}
			}
		}
	}

	walk(srcDir);
	return diffs;
}

export function diffTemplates(baseDir: string, wsDir: string, repos: string[]): TemplateDiff[] {
	const result: TemplateDiff[] = [];

	const wsTemplateDir = join(baseDir, ".arb", "templates", "workspace");
	for (const relPath of diffDirectory(wsTemplateDir, wsDir)) {
		result.push({ relPath, scope: "workspace" });
	}

	for (const repo of repos) {
		const repoTemplateDir = join(baseDir, ".arb", "templates", "repos", repo);
		const repoDir = join(wsDir, repo);
		if (!existsSync(repoDir)) continue;

		for (const relPath of diffDirectory(repoTemplateDir, repoDir)) {
			result.push({ relPath, scope: "repo", repo });
		}
	}

	return result;
}

// ── Template management helpers ──────────────────────────────────────

export interface TemplateEntry {
	scope: "workspace" | "repo";
	repo?: string;
	relPath: string;
}

export function listTemplates(baseDir: string): TemplateEntry[] {
	const result: TemplateEntry[] = [];
	const templatesDir = join(baseDir, ".arb", "templates");

	// Workspace templates
	const wsDir = join(templatesDir, "workspace");
	if (existsSync(wsDir)) {
		for (const relPath of walkFiles(wsDir)) {
			result.push({ scope: "workspace", relPath });
		}
	}

	// Repo templates
	const reposDir = join(templatesDir, "repos");
	if (existsSync(reposDir)) {
		for (const entry of readdirSync(reposDir)) {
			const repoTemplateDir = join(reposDir, entry);
			if (!lstatSync(repoTemplateDir).isDirectory()) continue;
			for (const relPath of walkFiles(repoTemplateDir)) {
				result.push({ scope: "repo", repo: entry, relPath });
			}
		}
	}

	return result;
}

function walkFiles(dir: string): string[] {
	const files: string[] = [];

	function walk(current: string): void {
		for (const entry of readdirSync(current)) {
			const fullPath = join(current, entry);
			const stat = lstatSync(fullPath);
			if (stat.isSymbolicLink()) continue;
			if (stat.isDirectory()) {
				walk(fullPath);
			} else if (stat.isFile()) {
				files.push(relative(dir, fullPath));
			}
		}
	}

	walk(dir);
	return files;
}

export interface TemplateScope {
	scope: "workspace" | "repo";
	repo?: string;
}

export function detectTemplateScope(baseDir: string, cwd: string): TemplateScope | null {
	const prefix = `${baseDir}/`;
	if (!cwd.startsWith(prefix)) return null;

	const rest = cwd.slice(prefix.length);
	const segments = rest.split("/");
	const firstSegment = segments[0];
	if (!firstSegment) return null;

	// Check if first segment is a workspace
	if (existsSync(join(baseDir, firstSegment, ".arbws"))) {
		// Inside a workspace — check if we're in a repo worktree
		const secondSegment = segments[1];
		if (secondSegment && existsSync(join(baseDir, firstSegment, secondSegment, ".git"))) {
			return { scope: "repo", repo: secondSegment };
		}
		return { scope: "workspace" };
	}

	return null;
}

export function removeTemplate(baseDir: string, scope: "workspace" | "repo", relPath: string, repo?: string): void {
	const repoName = repo ?? "";
	const templatePath =
		scope === "workspace"
			? join(baseDir, ".arb", "templates", "workspace", relPath)
			: join(baseDir, ".arb", "templates", "repos", repoName, relPath);

	if (!existsSync(templatePath)) {
		throw new Error(`Template does not exist: ${relPath}`);
	}

	unlinkSync(templatePath);

	// Clean up empty parent directories up to the scope root
	const scopeRoot =
		scope === "workspace"
			? join(baseDir, ".arb", "templates", "workspace")
			: join(baseDir, ".arb", "templates", "repos", repoName);

	let dir = dirname(templatePath);
	while (dir !== scopeRoot && dir.startsWith(scopeRoot)) {
		const entries = readdirSync(dir);
		if (entries.length > 0) break;
		rmdirSync(dir);
		dir = dirname(dir);
	}
}

export interface ForceOverlayResult {
	seeded: string[];
	reset: string[];
	unchanged: string[];
	failed: FailedCopy[];
}

export function forceOverlayDirectory(srcDir: string, destDir: string): ForceOverlayResult {
	if (!existsSync(srcDir)) return { seeded: [], reset: [], unchanged: [], failed: [] };

	const result: ForceOverlayResult = { seeded: [], reset: [], unchanged: [], failed: [] };

	function walk(dir: string): void {
		for (const entry of readdirSync(dir)) {
			const srcPath = join(dir, entry);
			const stat = lstatSync(srcPath);

			if (stat.isSymbolicLink()) continue;

			if (stat.isDirectory()) {
				walk(srcPath);
			} else if (stat.isFile()) {
				const relPath = relative(srcDir, srcPath);
				const destPath = join(destDir, relPath);

				try {
					if (!existsSync(destPath)) {
						mkdirSync(join(destDir, relative(srcDir, dir)), { recursive: true });
						copyFileSync(srcPath, destPath);
						result.seeded.push(relPath);
					} else {
						const srcContent = readFileSync(srcPath);
						const destContent = readFileSync(destPath);
						if (srcContent.equals(destContent)) {
							result.unchanged.push(relPath);
						} else {
							copyFileSync(srcPath, destPath);
							result.reset.push(relPath);
						}
					}
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					result.failed.push({ path: relPath, error: msg });
				}
			}
		}
	}

	walk(srcDir);
	return result;
}

export function forceApplyWorkspaceTemplates(baseDir: string, wsDir: string): ForceOverlayResult {
	const templateDir = join(baseDir, ".arb", "templates", "workspace");
	return forceOverlayDirectory(templateDir, wsDir);
}

export function forceApplyRepoTemplates(baseDir: string, wsDir: string, repos: string[]): ForceOverlayResult {
	const result: ForceOverlayResult = { seeded: [], reset: [], unchanged: [], failed: [] };

	for (const repo of repos) {
		const templateDir = join(baseDir, ".arb", "templates", "repos", repo);
		const repoDir = join(wsDir, repo);

		if (!existsSync(templateDir) || !existsSync(repoDir)) continue;

		const repoResult = forceOverlayDirectory(templateDir, repoDir);
		result.seeded.push(...repoResult.seeded);
		result.reset.push(...repoResult.reset);
		result.unchanged.push(...repoResult.unchanged);
		result.failed.push(...repoResult.failed);
	}

	return result;
}

export function displayTemplateDiffs(
	templateDiffs: TemplateDiff[],
	write: (text: string) => void,
	warnFn: (text: string) => void,
	suffix?: string,
): void {
	if (templateDiffs.length === 0) return;
	warnFn(`      Template files modified${suffix ?? ""}:`);
	for (const diff of templateDiffs) {
		const prefix = diff.scope === "repo" ? `[${diff.repo}] ` : "";
		write(`          ${prefix}${diff.relPath}\n`);
	}
	write("\n");
}

export function templateFilePath(baseDir: string, scope: "workspace" | "repo", relPath: string, repo?: string): string {
	return scope === "workspace"
		? join(baseDir, ".arb", "templates", "workspace", relPath)
		: join(baseDir, ".arb", "templates", "repos", repo ?? "", relPath);
}

export function workspaceFilePath(wsDir: string, scope: "workspace" | "repo", relPath: string, repo?: string): string {
	return scope === "workspace" ? join(wsDir, relPath) : join(wsDir, repo ?? "", relPath);
}
