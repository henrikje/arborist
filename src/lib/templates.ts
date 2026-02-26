import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { Liquid } from "liquidjs";
import { yellow } from "./output";
import { getRemoteUrl, resolveRemotes } from "./remotes";
import { workspaceRepoDirs } from "./repos";

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

export interface UnknownVariable {
	varName: string;
	filePath: string;
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

function knownVariablePaths(ctx: TemplateContext): Set<string> {
	const paths = new Set(["root.path", "workspace.name", "workspace.path", "workspace.repos"]);
	if (ctx.repoName) {
		paths.add("repo.name");
		paths.add("repo.path");
		paths.add("repo.baseRemote.name");
		paths.add("repo.baseRemote.url");
		paths.add("repo.shareRemote.name");
		paths.add("repo.shareRemote.url");
	}
	return paths;
}

function isKnownPath(varPath: string, known: Set<string>): boolean {
	if (known.has(varPath)) return true;
	// Check if varPath is a valid prefix of any known path
	const prefix = `${varPath}.`;
	for (const k of known) {
		if (k.startsWith(prefix)) return true;
	}
	return false;
}

export function checkUnknownVariables(content: string, ctx: TemplateContext): string[] {
	const ast = liquid.parse(content);
	const vars = liquid.globalFullVariablesSync(ast);
	const known = knownVariablePaths(ctx);
	const unknowns: string[] = [];
	const seen = new Set<string>();
	for (const v of vars) {
		if (!seen.has(v) && !isKnownPath(v, known)) {
			unknowns.push(v);
			seen.add(v);
		}
	}
	return unknowns;
}

export function displayUnknownVariables(
	unknowns: UnknownVariable[],
	write: (text: string) => void = (t) => process.stderr.write(t),
): void {
	if (unknowns.length === 0) return;
	write(`\n      ${yellow("Unknown template variables")}:\n`);
	for (const { varName, filePath } of unknowns) {
		write(`          '${varName}' in ${filePath}\n`);
	}
}

function collectUnknownVariables(content: string, ctx: TemplateContext, filePath: string): UnknownVariable[] {
	return checkUnknownVariables(content, ctx).map((varName) => ({ varName, filePath }));
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
	conflicts: string[];
	failed: FailedCopy[];
	unknownVariables: UnknownVariable[];
}

function emptyResult(): OverlayResult {
	return { seeded: [], skipped: [], regenerated: [], conflicts: [], failed: [], unknownVariables: [] };
}

export function overlayDirectory(
	srcDir: string,
	destDir: string,
	ctx?: TemplateContext,
	tplPathPrefix?: string,
): OverlayResult {
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
					result.conflicts.push(relPath);
					continue;
				}
				seen.add(relPath);

				const destPath = join(destDir, relPath);
				const tplContent = isArbtpl && ctx ? readFileSync(srcPath, "utf-8") : null;

				if (tplContent !== null && ctx) {
					const displayPath = tplPathPrefix ? `${tplPathPrefix}/${rawRelPath}` : rawRelPath;
					result.unknownVariables.push(...collectUnknownVariables(tplContent, ctx, displayPath));
				}

				if (!existsSync(destPath)) {
					try {
						mkdirSync(join(destDir, relative(srcDir, dir)), { recursive: true });
						if (tplContent !== null && ctx) {
							writeFileSync(destPath, renderTemplate(tplContent, ctx));
						} else {
							copyFileSync(srcPath, destPath);
						}
						result.seeded.push(relPath);
					} catch (e) {
						const msg = e instanceof Error ? e.message : String(e);
						result.failed.push({ path: relPath, error: msg });
					}
				} else if (tplContent !== null && ctx?.previousRepos) {
					// Membership change: check if file should be regenerated
					try {
						const newRender = renderTemplate(tplContent, ctx);
						const existingContent = readFileSync(destPath, "utf-8");

						if (existingContent === newRender) {
							result.skipped.push(relPath);
						} else {
							// Render with previous context to check for user edits
							const prevCtx: TemplateContext = { ...ctx, repos: ctx.previousRepos };
							const prevRender = renderTemplate(tplContent, prevCtx);

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

	return overlayDirectory(templateDir, wsDir, ctx, ".arb/templates/workspace");
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
		const repoResult = overlayDirectory(templateDir, repoDir, ctx, `.arb/templates/repos/${repo}`);
		result.seeded.push(...repoResult.seeded);
		result.skipped.push(...repoResult.skipped);
		result.regenerated.push(...repoResult.regenerated);
		result.conflicts.push(...repoResult.conflicts);
		result.failed.push(...repoResult.failed);
		result.unknownVariables.push(...repoResult.unknownVariables);
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
	kind: "modified" | "deleted";
}

interface DiffDirectoryResult {
	modified: string[];
	deleted: string[];
}

function diffDirectory(srcDir: string, destDir: string, ctx?: TemplateContext): DiffDirectoryResult {
	if (!existsSync(srcDir)) return { modified: [], deleted: [] };

	const modified: string[] = [];
	const deleted: string[] = [];
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

				if (!existsSync(destPath)) {
					deleted.push(relPath);
					continue;
				}

				const srcContent =
					isArbtpl && ctx ? Buffer.from(renderTemplate(readFileSync(srcPath, "utf-8"), ctx)) : readFileSync(srcPath);
				const destContent = readFileSync(destPath);
				if (!srcContent.equals(destContent)) {
					modified.push(relPath);
				}
			}
		}
	}

	walk(srcDir);
	return { modified, deleted };
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
	const wsDiffs = diffDirectory(wsTemplateDir, wsDir, wsCtx);
	for (const relPath of wsDiffs.modified) {
		result.push({ relPath, scope: "workspace", kind: "modified" });
	}
	for (const relPath of wsDiffs.deleted) {
		result.push({ relPath, scope: "workspace", kind: "deleted" });
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
		const repoDiffs = diffDirectory(repoTemplateDir, repoDir, repoCtx);
		for (const relPath of repoDiffs.modified) {
			result.push({ relPath, scope: "repo", repo, kind: "modified" });
		}
		for (const relPath of repoDiffs.deleted) {
			result.push({ relPath, scope: "repo", repo, kind: "deleted" });
		}
	}

	return result;
}

export async function checkAllTemplateVariables(
	arbRootDir: string,
	wsDir: string,
	repos: string[],
): Promise<UnknownVariable[]> {
	const unknowns: UnknownVariable[] = [];
	const reposDir = join(arbRootDir, ".arb", "repos");
	const allRepos = await workspaceRepoList(wsDir, reposDir);
	const templatesDir = join(arbRootDir, ".arb", "templates");

	const wsTemplateDir = join(templatesDir, "workspace");
	const wsCtx: TemplateContext = {
		rootPath: arbRootDir,
		workspaceName: basename(wsDir),
		workspacePath: wsDir,
		repos: allRepos,
	};
	if (existsSync(wsTemplateDir)) {
		for (const rawRelPath of walkFiles(wsTemplateDir)) {
			if (isTemplateFile(rawRelPath)) {
				const content = readFileSync(join(wsTemplateDir, rawRelPath), "utf-8");
				const tplPath = `.arb/templates/workspace/${rawRelPath}`;
				unknowns.push(...collectUnknownVariables(content, wsCtx, tplPath));
			}
		}
	}

	for (const repo of repos) {
		const repoTemplateDir = join(templatesDir, "repos", repo);
		const repoDir = join(wsDir, repo);
		if (!existsSync(repoTemplateDir)) continue;

		const repoCtx: TemplateContext = {
			rootPath: arbRootDir,
			workspaceName: basename(wsDir),
			workspacePath: wsDir,
			repoName: repo,
			repoPath: existsSync(repoDir) ? repoDir : undefined,
			repos: allRepos,
		};
		for (const rawRelPath of walkFiles(repoTemplateDir)) {
			if (isTemplateFile(rawRelPath)) {
				const content = readFileSync(join(repoTemplateDir, rawRelPath), "utf-8");
				const tplPath = `.arb/templates/repos/${repo}/${rawRelPath}`;
				unknowns.push(...collectUnknownVariables(content, repoCtx, tplPath));
			}
		}
	}

	return unknowns;
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

export function detectScopeFromPath(wsDir: string, srcPath: string): TemplateScope | null {
	const wsPrefix = `${wsDir}/`;
	if (!srcPath.startsWith(wsPrefix)) return null;

	for (const repoDir of workspaceRepoDirs(wsDir)) {
		if (srcPath.startsWith(`${repoDir}/`) || srcPath === repoDir) {
			return { scope: "repo", repo: basename(repoDir) };
		}
	}

	return { scope: "workspace" };
}

export interface ForceOverlayResult {
	seeded: string[];
	reset: string[];
	unchanged: string[];
	conflicts: string[];
	failed: FailedCopy[];
	unknownVariables: UnknownVariable[];
}

export function forceOverlayDirectory(
	srcDir: string,
	destDir: string,
	ctx?: TemplateContext,
	tplPathPrefix?: string,
): ForceOverlayResult {
	if (!existsSync(srcDir))
		return { seeded: [], reset: [], unchanged: [], conflicts: [], failed: [], unknownVariables: [] };

	const result: ForceOverlayResult = {
		seeded: [],
		reset: [],
		unchanged: [],
		conflicts: [],
		failed: [],
		unknownVariables: [],
	};
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
					result.conflicts.push(relPath);
					continue;
				}
				seen.add(relPath);

				const destPath = join(destDir, relPath);
				const tplContent = isArbtpl && ctx ? readFileSync(srcPath, "utf-8") : null;

				if (tplContent !== null && ctx) {
					const displayPath = tplPathPrefix ? `${tplPathPrefix}/${rawRelPath}` : rawRelPath;
					result.unknownVariables.push(...collectUnknownVariables(tplContent, ctx, displayPath));
				}

				try {
					if (!existsSync(destPath)) {
						mkdirSync(join(destDir, relative(srcDir, dir)), { recursive: true });
						if (tplContent !== null && ctx) {
							writeFileSync(destPath, renderTemplate(tplContent, ctx));
						} else {
							copyFileSync(srcPath, destPath);
						}
						result.seeded.push(relPath);
					} else {
						const srcContent =
							tplContent !== null && ctx ? Buffer.from(renderTemplate(tplContent, ctx)) : readFileSync(srcPath);
						const destContent = readFileSync(destPath);
						if (srcContent.equals(destContent)) {
							result.unchanged.push(relPath);
						} else {
							if (tplContent !== null && ctx) {
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
	return forceOverlayDirectory(templateDir, wsDir, ctx, ".arb/templates/workspace");
}

export async function forceApplyRepoTemplates(
	arbRootDir: string,
	wsDir: string,
	repos: string[],
): Promise<ForceOverlayResult> {
	const result: ForceOverlayResult = {
		seeded: [],
		reset: [],
		unchanged: [],
		conflicts: [],
		failed: [],
		unknownVariables: [],
	};
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
		const repoResult = forceOverlayDirectory(templateDir, repoDir, ctx, `.arb/templates/repos/${repo}`);
		result.seeded.push(...repoResult.seeded);
		result.reset.push(...repoResult.reset);
		result.unchanged.push(...repoResult.unchanged);
		result.conflicts.push(...repoResult.conflicts);
		result.failed.push(...repoResult.failed);
		result.unknownVariables.push(...repoResult.unknownVariables);
	}

	return result;
}

export function displayTemplateDiffs(
	templateDiffs: TemplateDiff[],
	write: (text: string) => void,
	suffix?: string,
): void {
	if (templateDiffs.length === 0) return;
	const modified = templateDiffs.filter((d) => d.kind === "modified");
	const deleted = templateDiffs.filter((d) => d.kind === "deleted");
	if (modified.length > 0) {
		write(`      ${yellow(`Template files modified${suffix ?? ""}`)}:\n`);
		for (const diff of modified) {
			const prefix = diff.scope === "repo" ? `[${diff.repo}] ` : "";
			write(`          ${prefix}${diff.relPath}\n`);
		}
		write("\n");
	}
	if (deleted.length > 0) {
		write(`      ${yellow(`Template files deleted${suffix ?? ""}`)}:\n`);
		for (const diff of deleted) {
			const prefix = diff.scope === "repo" ? `[${diff.repo}] ` : "";
			write(`          ${prefix}${diff.relPath}\n`);
		}
		write("\n");
	}
}

export interface ConflictInfo {
	scope: "workspace" | "repo";
	repo?: string;
	relPath: string;
}

export function displayTemplateConflicts(
	conflicts: ConflictInfo[],
	write: (text: string) => void = (t) => process.stderr.write(t),
): void {
	if (conflicts.length === 0) return;
	write(`\n      ${yellow("Conflicting templates (both plain and .arbtemplate versions exist)")}:\n`);
	for (const c of conflicts) {
		const tplDir = c.scope === "workspace" ? ".arb/templates/workspace" : `.arb/templates/repos/${c.repo}`;
		const arbtplName = `${basename(c.relPath)}${ARBTEMPLATE_EXT}`;
		write(`          remove either ${tplDir}/${c.relPath} or ${arbtplName}\n`);
	}
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
