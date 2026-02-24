import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmdirSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { Liquid } from "liquidjs";
import { getRemoteUrl, resolveRemotes } from "./remotes";

export const ARBTEMPLATE_EXT = ".arbtemplate";

const liquid = new Liquid({ strictVariables: false });

export interface RemoteInfo {
	name: string;
	url: string;
}

export interface RepoInfo {
	name: string;
	path: string;
	baseRemote: RemoteInfo;
	shareRemote: RemoteInfo;
}

export interface TemplateContext {
	rootPath: string;
	workspaceName: string;
	workspacePath: string;
	repoName?: string;
	repoPath?: string;
	repos?: RepoInfo[];
	previousRepos?: RepoInfo[];
}

function toTemplateData(ctx: TemplateContext): Record<string, unknown> {
	const currentRepo = ctx.repoName
		? (ctx.repos?.find((r) => r.name === ctx.repoName) ?? {
				name: ctx.repoName,
				path: ctx.repoPath,
				baseRemote: { name: "", url: "" },
				shareRemote: { name: "", url: "" },
			})
		: undefined;
	return {
		root: { path: ctx.rootPath },
		workspace: {
			name: ctx.workspaceName,
			path: ctx.workspacePath,
			repos: ctx.repos ?? [],
		},
		repo: currentRepo,
	};
}

export function renderTemplate(content: string, ctx: TemplateContext): string {
	return liquid.parseAndRenderSync(content, toTemplateData(ctx));
}

function isTemplateFile(relPath: string): boolean {
	return relPath.endsWith(ARBTEMPLATE_EXT);
}

function stripTemplateExt(relPath: string): string {
	return relPath.slice(0, -ARBTEMPLATE_EXT.length);
}

export interface FailedCopy {
	path: string;
	error: string;
}

export interface OverlayResult {
	seeded: string[];
	skipped: string[];
	regenerated: string[];
	failed: FailedCopy[];
}

function emptyResult(): OverlayResult {
	return { seeded: [], skipped: [], regenerated: [], failed: [] };
}

export function overlayDirectory(srcDir: string, destDir: string, ctx?: TemplateContext): OverlayResult {
	if (!existsSync(srcDir)) return emptyResult();

	const result = emptyResult();
	const seen = new Set<string>();

	function walk(dir: string): void {
		for (const entry of readdirSync(dir)) {
			const srcPath = join(dir, entry);
			const stat = lstatSync(srcPath);

			if (stat.isSymbolicLink()) continue;

			if (stat.isDirectory()) {
				walk(srcPath);
			} else if (stat.isFile()) {
				const rawRelPath = relative(srcDir, srcPath);
				const isArbtpl = isTemplateFile(rawRelPath);
				const relPath = isArbtpl ? stripTemplateExt(rawRelPath) : rawRelPath;

				if (seen.has(relPath)) {
					result.failed.push({
						path: relPath,
						error: `Conflict: both ${relPath} and ${relPath}${ARBTEMPLATE_EXT} exist — remove one`,
					});
					continue;
				}
				seen.add(relPath);

				const destPath = join(destDir, relPath);

				if (!existsSync(destPath)) {
					try {
						mkdirSync(join(destDir, relative(srcDir, dir)), { recursive: true });
						if (isArbtpl && ctx) {
							const content = readFileSync(srcPath, "utf-8");
							writeFileSync(destPath, renderTemplate(content, ctx));
						} else {
							copyFileSync(srcPath, destPath);
						}
						result.seeded.push(relPath);
					} catch (e) {
						const msg = e instanceof Error ? e.message : String(e);
						result.failed.push({ path: relPath, error: msg });
					}
				} else if (isArbtpl && ctx?.previousRepos) {
					// Membership change: check if file should be regenerated
					try {
						const templateContent = readFileSync(srcPath, "utf-8");
						const newRender = renderTemplate(templateContent, ctx);
						const existingContent = readFileSync(destPath, "utf-8");

						if (existingContent === newRender) {
							result.skipped.push(relPath);
						} else {
							// Render with previous context to check for user edits
							const prevCtx: TemplateContext = { ...ctx, repos: ctx.previousRepos };
							const prevRender = renderTemplate(templateContent, prevCtx);

							if (existingContent === prevRender) {
								// User hasn't edited — safe to overwrite
								writeFileSync(destPath, newRender);
								result.regenerated.push(relPath);
							} else {
								// User has edited — don't overwrite
								result.skipped.push(relPath);
							}
						}
					} catch (e) {
						const msg = e instanceof Error ? e.message : String(e);
						result.failed.push({ path: relPath, error: msg });
					}
				} else {
					result.skipped.push(relPath);
				}
			}
		}
	}

	walk(srcDir);
	return result;
}

export async function applyWorkspaceTemplates(
	arbRootDir: string,
	wsDir: string,
	changedRepos?: { added?: string[]; removed?: string[] },
): Promise<OverlayResult> {
	const templateDir = join(arbRootDir, ".arb", "templates", "workspace");
	const reposDir = join(arbRootDir, ".arb", "repos");
	const repos = await workspaceRepoList(wsDir, reposDir);
	const ctx: TemplateContext = {
		rootPath: arbRootDir,
		workspaceName: basename(wsDir),
		workspacePath: wsDir,
		repos,
	};

	if (changedRepos) {
		ctx.previousRepos = await reconstructPreviousRepos(repos, changedRepos, reposDir);
	}

	return overlayDirectory(templateDir, wsDir, ctx);
}

export async function applyRepoTemplates(
	arbRootDir: string,
	wsDir: string,
	repos: string[],
	changedRepos?: { added?: string[]; removed?: string[] },
): Promise<OverlayResult> {
	const result = emptyResult();
	const reposDir = join(arbRootDir, ".arb", "repos");
	const allRepos = await workspaceRepoList(wsDir, reposDir);

	for (const repo of repos) {
		const templateDir = join(arbRootDir, ".arb", "templates", "repos", repo);
		const repoDir = join(wsDir, repo);

		if (!existsSync(templateDir) || !existsSync(repoDir)) continue;

		const ctx: TemplateContext = {
			rootPath: arbRootDir,
			workspaceName: basename(wsDir),
			workspacePath: wsDir,
			repoName: repo,
			repoPath: repoDir,
			repos: allRepos,
		};
		if (changedRepos) {
			ctx.previousRepos = await reconstructPreviousRepos(allRepos, changedRepos, reposDir);
		}
		const repoResult = overlayDirectory(templateDir, repoDir, ctx);
		result.seeded.push(...repoResult.seeded);
		result.skipped.push(...repoResult.skipped);
		result.regenerated.push(...repoResult.regenerated);
		result.failed.push(...repoResult.failed);
	}

	return result;
}

const emptyRemote: RemoteInfo = { name: "", url: "" };

/** Resolve remote info for a single repo, falling back to empty on error. */
async function resolveRepoRemoteInfo(repoDir: string): Promise<{ baseRemote: RemoteInfo; shareRemote: RemoteInfo }> {
	try {
		const remotes = await resolveRemotes(repoDir);
		const baseUrl = await getRemoteUrl(repoDir, remotes.base);
		const shareUrl = remotes.share !== remotes.base ? await getRemoteUrl(repoDir, remotes.share) : baseUrl;
		return {
			baseRemote: { name: remotes.base, url: baseUrl ?? "" },
			shareRemote: { name: remotes.share, url: shareUrl ?? "" },
		};
	} catch {
		return { baseRemote: emptyRemote, shareRemote: emptyRemote };
	}
}

/** Build the repo list for template context from a workspace directory. */
export async function workspaceRepoList(wsDir: string, reposDir: string): Promise<RepoInfo[]> {
	if (!existsSync(wsDir)) return [];
	const dirs = readdirSync(wsDir)
		.filter((entry) => entry !== ".arbws")
		.map((entry) => join(wsDir, entry))
		.filter((fullPath) => {
			try {
				return lstatSync(fullPath).isDirectory() && existsSync(join(fullPath, ".git"));
			} catch {
				return false;
			}
		})
		.sort();

	const results: RepoInfo[] = [];
	for (const fullPath of dirs) {
		const name = basename(fullPath);
		// Resolve remotes from canonical repo (workspace repos may not have independent remote config)
		const canonicalDir = join(reposDir, name);
		const remoteDir = existsSync(canonicalDir) ? canonicalDir : fullPath;
		const { baseRemote, shareRemote } = await resolveRepoRemoteInfo(remoteDir);
		results.push({ name, path: fullPath, baseRemote, shareRemote });
	}
	return results;
}

/** Reconstruct previous repo list by reversing the change. */
async function reconstructPreviousRepos(
	currentRepos: RepoInfo[],
	changedRepos: { added?: string[]; removed?: string[] },
	reposDir: string,
): Promise<RepoInfo[]> {
	const addedSet = new Set(changedRepos.added ?? []);
	const removedSet = new Set(changedRepos.removed ?? []);

	// Previous = current minus added plus removed
	const prev = currentRepos.filter((r) => !addedSet.has(r.name));

	// Add back removed repos (resolve remotes from canonical repo)
	for (const name of removedSet) {
		if (!prev.some((r) => r.name === name)) {
			const wsDir = currentRepos.length > 0 ? dirname(currentRepos[0]?.path ?? "") : "";
			if (wsDir) {
				const canonicalDir = join(reposDir, name);
				const { baseRemote, shareRemote } = await resolveRepoRemoteInfo(canonicalDir);
				prev.push({ name, path: join(wsDir, name), baseRemote, shareRemote });
			}
		}
	}

	return prev.sort((a, b) => a.path.localeCompare(b.path));
}

export interface TemplateDiff {
	relPath: string;
	scope: "workspace" | "repo";
	repo?: string;
}

function diffDirectory(srcDir: string, destDir: string, ctx?: TemplateContext): string[] {
	if (!existsSync(srcDir)) return [];

	const diffs: string[] = [];
	const seen = new Set<string>();

	function walk(dir: string): void {
		for (const entry of readdirSync(dir)) {
			const srcPath = join(dir, entry);
			const stat = lstatSync(srcPath);

			if (stat.isSymbolicLink()) continue;

			if (stat.isDirectory()) {
				walk(srcPath);
			} else if (stat.isFile()) {
				const rawRelPath = relative(srcDir, srcPath);
				const isArbtpl = isTemplateFile(rawRelPath);
				const relPath = isArbtpl ? stripTemplateExt(rawRelPath) : rawRelPath;

				if (seen.has(relPath)) continue;
				seen.add(relPath);

				const destPath = join(destDir, relPath);

				if (!existsSync(destPath)) continue;

				const srcContent =
					isArbtpl && ctx ? Buffer.from(renderTemplate(readFileSync(srcPath, "utf-8"), ctx)) : readFileSync(srcPath);
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

export async function diffTemplates(arbRootDir: string, wsDir: string, repos: string[]): Promise<TemplateDiff[]> {
	const result: TemplateDiff[] = [];
	const reposDir = join(arbRootDir, ".arb", "repos");
	const allRepos = await workspaceRepoList(wsDir, reposDir);

	const wsTemplateDir = join(arbRootDir, ".arb", "templates", "workspace");
	const wsCtx: TemplateContext = {
		rootPath: arbRootDir,
		workspaceName: basename(wsDir),
		workspacePath: wsDir,
		repos: allRepos,
	};
	for (const relPath of diffDirectory(wsTemplateDir, wsDir, wsCtx)) {
		result.push({ relPath, scope: "workspace" });
	}

	for (const repo of repos) {
		const repoTemplateDir = join(arbRootDir, ".arb", "templates", "repos", repo);
		const repoDir = join(wsDir, repo);
		if (!existsSync(repoDir)) continue;

		const repoCtx: TemplateContext = {
			rootPath: arbRootDir,
			workspaceName: basename(wsDir),
			workspacePath: wsDir,
			repoName: repo,
			repoPath: repoDir,
			repos: allRepos,
		};
		for (const relPath of diffDirectory(repoTemplateDir, repoDir, repoCtx)) {
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
	isTemplate?: boolean;
	conflict?: boolean;
}

export function listTemplates(arbRootDir: string): TemplateEntry[] {
	const seen = new Map<string, TemplateEntry>();
	const templatesDir = join(arbRootDir, ".arb", "templates");

	function addEntry(entry: TemplateEntry): void {
		const key = `${entry.scope}:${entry.repo ?? ""}:${entry.relPath}`;
		const existing = seen.get(key);
		if (existing) {
			// Prefer the plain file over .arbtemplate; flag the conflict
			if (existing.isTemplate && !entry.isTemplate) {
				seen.set(key, { ...entry, conflict: true });
			} else {
				existing.conflict = true;
			}
		} else {
			seen.set(key, entry);
		}
	}

	// Workspace templates
	const wsDir = join(templatesDir, "workspace");
	if (existsSync(wsDir)) {
		for (const rawRelPath of walkFiles(wsDir)) {
			if (isTemplateFile(rawRelPath)) {
				addEntry({ scope: "workspace", relPath: stripTemplateExt(rawRelPath), isTemplate: true });
			} else {
				addEntry({ scope: "workspace", relPath: rawRelPath });
			}
		}
	}

	// Repo templates
	const reposDir = join(templatesDir, "repos");
	if (existsSync(reposDir)) {
		for (const entry of readdirSync(reposDir)) {
			const repoTemplateDir = join(reposDir, entry);
			if (!lstatSync(repoTemplateDir).isDirectory()) continue;
			for (const rawRelPath of walkFiles(repoTemplateDir)) {
				if (isTemplateFile(rawRelPath)) {
					addEntry({ scope: "repo", repo: entry, relPath: stripTemplateExt(rawRelPath), isTemplate: true });
				} else {
					addEntry({ scope: "repo", repo: entry, relPath: rawRelPath });
				}
			}
		}
	}

	return [...seen.values()];
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

export function detectTemplateScope(arbRootDir: string, cwd: string): TemplateScope | null {
	const prefix = `${arbRootDir}/`;
	if (!cwd.startsWith(prefix)) return null;

	const rest = cwd.slice(prefix.length);
	const segments = rest.split("/");
	const firstSegment = segments[0];
	if (!firstSegment) return null;

	// Check if first segment is a workspace
	if (existsSync(join(arbRootDir, firstSegment, ".arbws"))) {
		// Inside a workspace — check if we're in a repo directory
		const secondSegment = segments[1];
		if (secondSegment && existsSync(join(arbRootDir, firstSegment, secondSegment, ".git"))) {
			return { scope: "repo", repo: secondSegment };
		}
		return { scope: "workspace" };
	}

	return null;
}

export function removeTemplate(arbRootDir: string, scope: "workspace" | "repo", relPath: string, repo?: string): void {
	const repoName = repo ?? "";
	const plainPath =
		scope === "workspace"
			? join(arbRootDir, ".arb", "templates", "workspace", relPath)
			: join(arbRootDir, ".arb", "templates", "repos", repoName, relPath);

	const arbtplPath = `${plainPath}${ARBTEMPLATE_EXT}`;
	const templatePath = existsSync(plainPath) ? plainPath : existsSync(arbtplPath) ? arbtplPath : null;

	if (!templatePath) {
		throw new Error(`Template does not exist: ${relPath}`);
	}

	unlinkSync(templatePath);

	// Clean up empty parent directories up to the scope root
	const scopeRoot =
		scope === "workspace"
			? join(arbRootDir, ".arb", "templates", "workspace")
			: join(arbRootDir, ".arb", "templates", "repos", repoName);

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

export function forceOverlayDirectory(srcDir: string, destDir: string, ctx?: TemplateContext): ForceOverlayResult {
	if (!existsSync(srcDir)) return { seeded: [], reset: [], unchanged: [], failed: [] };

	const result: ForceOverlayResult = { seeded: [], reset: [], unchanged: [], failed: [] };
	const seen = new Set<string>();

	function walk(dir: string): void {
		for (const entry of readdirSync(dir)) {
			const srcPath = join(dir, entry);
			const stat = lstatSync(srcPath);

			if (stat.isSymbolicLink()) continue;

			if (stat.isDirectory()) {
				walk(srcPath);
			} else if (stat.isFile()) {
				const rawRelPath = relative(srcDir, srcPath);
				const isArbtpl = isTemplateFile(rawRelPath);
				const relPath = isArbtpl ? stripTemplateExt(rawRelPath) : rawRelPath;

				if (seen.has(relPath)) {
					result.failed.push({
						path: relPath,
						error: `Conflict: both ${relPath} and ${relPath}${ARBTEMPLATE_EXT} exist — remove one`,
					});
					continue;
				}
				seen.add(relPath);

				const destPath = join(destDir, relPath);

				try {
					if (!existsSync(destPath)) {
						mkdirSync(join(destDir, relative(srcDir, dir)), { recursive: true });
						if (isArbtpl && ctx) {
							const content = readFileSync(srcPath, "utf-8");
							writeFileSync(destPath, renderTemplate(content, ctx));
						} else {
							copyFileSync(srcPath, destPath);
						}
						result.seeded.push(relPath);
					} else {
						const srcContent =
							isArbtpl && ctx
								? Buffer.from(renderTemplate(readFileSync(srcPath, "utf-8"), ctx))
								: readFileSync(srcPath);
						const destContent = readFileSync(destPath);
						if (srcContent.equals(destContent)) {
							result.unchanged.push(relPath);
						} else {
							if (isArbtpl && ctx) {
								writeFileSync(destPath, srcContent);
							} else {
								copyFileSync(srcPath, destPath);
							}
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

export async function forceApplyWorkspaceTemplates(arbRootDir: string, wsDir: string): Promise<ForceOverlayResult> {
	const templateDir = join(arbRootDir, ".arb", "templates", "workspace");
	const reposDir = join(arbRootDir, ".arb", "repos");
	const repos = await workspaceRepoList(wsDir, reposDir);
	const ctx: TemplateContext = {
		rootPath: arbRootDir,
		workspaceName: basename(wsDir),
		workspacePath: wsDir,
		repos,
	};
	return forceOverlayDirectory(templateDir, wsDir, ctx);
}

export async function forceApplyRepoTemplates(
	arbRootDir: string,
	wsDir: string,
	repos: string[],
): Promise<ForceOverlayResult> {
	const result: ForceOverlayResult = { seeded: [], reset: [], unchanged: [], failed: [] };
	const reposDir = join(arbRootDir, ".arb", "repos");
	const allRepos = await workspaceRepoList(wsDir, reposDir);

	for (const repo of repos) {
		const templateDir = join(arbRootDir, ".arb", "templates", "repos", repo);
		const repoDir = join(wsDir, repo);

		if (!existsSync(templateDir) || !existsSync(repoDir)) continue;

		const ctx: TemplateContext = {
			rootPath: arbRootDir,
			workspaceName: basename(wsDir),
			workspacePath: wsDir,
			repoName: repo,
			repoPath: repoDir,
			repos: allRepos,
		};
		const repoResult = forceOverlayDirectory(templateDir, repoDir, ctx);
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
	suffix?: string,
): void {
	if (templateDiffs.length === 0) return;
	write(`      Template files modified${suffix ?? ""}:\n`);
	for (const diff of templateDiffs) {
		const prefix = diff.scope === "repo" ? `[${diff.repo}] ` : "";
		write(`          ${prefix}${diff.relPath}\n`);
	}
	write("\n");
}

export function templateFilePath(
	arbRootDir: string,
	scope: "workspace" | "repo",
	relPath: string,
	repo?: string,
): string {
	const plainPath =
		scope === "workspace"
			? join(arbRootDir, ".arb", "templates", "workspace", relPath)
			: join(arbRootDir, ".arb", "templates", "repos", repo ?? "", relPath);

	if (existsSync(plainPath)) return plainPath;

	const arbtplPath = `${plainPath}${ARBTEMPLATE_EXT}`;
	if (existsSync(arbtplPath)) return arbtplPath;

	return plainPath;
}

export function workspaceFilePath(wsDir: string, scope: "workspace" | "repo", relPath: string, repo?: string): string {
	return scope === "workspace" ? join(wsDir, relPath) : join(wsDir, repo ?? "", relPath);
}
