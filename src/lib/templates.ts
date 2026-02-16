import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

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
