import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
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
