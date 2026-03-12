import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { GitCache } from "../git/git-cache";
import { listRepos, workspaceRepoDirs } from "../workspace/repos";
import { manifestKey, mergeManifest } from "./manifest";
import { forceOverlayDirectory, isTemplateFile, overlayDirectory, stripTemplateExt, walkFiles } from "./overlay";
import { collectUnknownVariables } from "./render";
import type {
  ForceOverlayResult,
  OverlayResult,
  RemoteInfo,
  RepoInfo,
  TemplateContext,
  TemplateEntry,
  TemplateScope,
  UnknownVariable,
} from "./types";

const emptyRemote: RemoteInfo = { name: "", url: "" };

/** Resolve remote info for a single repo, falling back to empty on error. */
async function resolveRepoRemoteInfo(
  repoDir: string,
  cache: GitCache,
): Promise<{ baseRemote: RemoteInfo; shareRemote: RemoteInfo }> {
  try {
    const remotes = await cache.resolveRemotes(repoDir);
    const baseUrl = await cache.getRemoteUrl(repoDir, remotes.base);
    const shareUrl = remotes.share !== remotes.base ? await cache.getRemoteUrl(repoDir, remotes.share) : baseUrl;
    return {
      baseRemote: { name: remotes.base, url: baseUrl ?? "" },
      shareRemote: { name: remotes.share, url: shareUrl ?? "" },
    };
  } catch {
    return { baseRemote: emptyRemote, shareRemote: emptyRemote };
  }
}

/** Build the repo list for template context from a workspace directory. */
export async function workspaceRepoList(wsDir: string, reposDir: string, cache?: GitCache): Promise<RepoInfo[]> {
  if (!existsSync(wsDir)) return [];
  const c = cache ?? new GitCache();
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
    const { baseRemote, shareRemote } = await resolveRepoRemoteInfo(remoteDir, c);
    results.push({ name, path: fullPath, baseRemote, shareRemote });
  }
  return results;
}

/** Reconstruct previous repo list by reversing the change. */
async function reconstructPreviousRepos(
  currentRepos: RepoInfo[],
  changedRepos: { added?: string[]; removed?: string[] },
  reposDir: string,
  cache: GitCache,
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
        const { baseRemote, shareRemote } = await resolveRepoRemoteInfo(canonicalDir, cache);
        prev.push({ name, path: join(wsDir, name), baseRemote, shareRemote });
      }
    }
  }

  return prev.sort((a, b) => a.path.localeCompare(b.path));
}

function emptyOverlayResult(): OverlayResult {
  return {
    seeded: [],
    skipped: [],
    regenerated: [],
    conflicts: [],
    failed: [],
    unknownVariables: [],
    repoDirectoryWarnings: [],
    seededHashes: {},
  };
}

function emptyForceOverlayResult(): ForceOverlayResult {
  return {
    seeded: [],
    reset: [],
    unchanged: [],
    conflicts: [],
    failed: [],
    unknownVariables: [],
    repoDirectoryWarnings: [],
    seededHashes: {},
  };
}

export async function applyWorkspaceTemplates(
  arbRootDir: string,
  wsDir: string,
  changedRepos?: { added?: string[]; removed?: string[] },
  cache?: GitCache,
): Promise<OverlayResult> {
  const templateDir = join(arbRootDir, ".arb", "templates", "workspace");
  const reposDir = join(arbRootDir, ".arb", "repos");
  const c = cache ?? new GitCache();
  const repos = await workspaceRepoList(wsDir, reposDir, c);
  const ctx: TemplateContext = {
    rootPath: arbRootDir,
    workspaceName: basename(wsDir),
    workspacePath: wsDir,
    repos,
  };

  if (changedRepos) {
    ctx.previousRepos = await reconstructPreviousRepos(repos, changedRepos, reposDir, c);
  }

  const result = overlayDirectory(templateDir, wsDir, ctx, ".arb/templates/workspace", "workspace");
  result.repoDirectoryWarnings = checkWorkspaceTemplateRepoWarnings(arbRootDir);
  const manifestEntries: Record<string, string> = {};
  for (const [relPath, hash] of Object.entries(result.seededHashes)) {
    manifestEntries[manifestKey("workspace", relPath)] = hash;
  }
  mergeManifest(wsDir, manifestEntries);
  return result;
}

export async function applyRepoTemplates(
  arbRootDir: string,
  wsDir: string,
  repos: string[],
  changedRepos?: { added?: string[]; removed?: string[] },
  cache?: GitCache,
): Promise<OverlayResult> {
  const result = emptyOverlayResult();
  const reposDir = join(arbRootDir, ".arb", "repos");
  const c = cache ?? new GitCache();
  const allRepos = await workspaceRepoList(wsDir, reposDir, c);

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
      ctx.previousRepos = await reconstructPreviousRepos(allRepos, changedRepos, reposDir, c);
    }
    const repoResult = overlayDirectory(templateDir, repoDir, ctx, `.arb/templates/repos/${repo}`, "repo", repo);
    result.seeded.push(...repoResult.seeded);
    result.skipped.push(...repoResult.skipped);
    result.regenerated.push(...repoResult.regenerated);
    result.conflicts.push(...repoResult.conflicts);
    result.failed.push(...repoResult.failed);
    result.unknownVariables.push(...repoResult.unknownVariables);
    const manifestEntries: Record<string, string> = {};
    for (const [relPath, hash] of Object.entries(repoResult.seededHashes)) {
      manifestEntries[manifestKey("repo", relPath, repo)] = hash;
    }
    mergeManifest(wsDir, manifestEntries);
  }

  return result;
}

export async function forceApplyWorkspaceTemplates(
  arbRootDir: string,
  wsDir: string,
  cache?: GitCache,
): Promise<ForceOverlayResult> {
  const templateDir = join(arbRootDir, ".arb", "templates", "workspace");
  const reposDir = join(arbRootDir, ".arb", "repos");
  const c = cache ?? new GitCache();
  const repos = await workspaceRepoList(wsDir, reposDir, c);
  const ctx: TemplateContext = {
    rootPath: arbRootDir,
    workspaceName: basename(wsDir),
    workspacePath: wsDir,
    repos,
  };
  const result = forceOverlayDirectory(templateDir, wsDir, ctx, ".arb/templates/workspace", "workspace");
  result.repoDirectoryWarnings = checkWorkspaceTemplateRepoWarnings(arbRootDir);
  const manifestEntries: Record<string, string> = {};
  for (const [relPath, hash] of Object.entries(result.seededHashes)) {
    manifestEntries[manifestKey("workspace", relPath)] = hash;
  }
  mergeManifest(wsDir, manifestEntries);
  return result;
}

export async function forceApplyRepoTemplates(
  arbRootDir: string,
  wsDir: string,
  repos: string[],
  cache?: GitCache,
): Promise<ForceOverlayResult> {
  const result = emptyForceOverlayResult();
  const reposDir = join(arbRootDir, ".arb", "repos");
  const c = cache ?? new GitCache();
  const allRepos = await workspaceRepoList(wsDir, reposDir, c);

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
    const repoResult = forceOverlayDirectory(templateDir, repoDir, ctx, `.arb/templates/repos/${repo}`, "repo", repo);
    result.seeded.push(...repoResult.seeded);
    result.reset.push(...repoResult.reset);
    result.unchanged.push(...repoResult.unchanged);
    result.conflicts.push(...repoResult.conflicts);
    result.failed.push(...repoResult.failed);
    result.unknownVariables.push(...repoResult.unknownVariables);
    const manifestEntries: Record<string, string> = {};
    for (const [relPath, hash] of Object.entries(repoResult.seededHashes)) {
      manifestEntries[manifestKey("repo", relPath, repo)] = hash;
    }
    mergeManifest(wsDir, manifestEntries);
  }

  return result;
}

export async function checkAllTemplateVariables(
  arbRootDir: string,
  wsDir: string,
  repos: string[],
  cache?: GitCache,
): Promise<UnknownVariable[]> {
  const unknowns: UnknownVariable[] = [];
  const reposDir = join(arbRootDir, ".arb", "repos");
  const c = cache ?? new GitCache();
  const allRepos = await workspaceRepoList(wsDir, reposDir, c);
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

  const arbtplPath = `${plainPath}.arbtemplate`;
  if (existsSync(arbtplPath)) return arbtplPath;

  return plainPath;
}

export function workspaceFilePath(wsDir: string, scope: "workspace" | "repo", relPath: string, repo?: string): string {
  return scope === "workspace" ? join(wsDir, relPath) : join(wsDir, repo ?? "", relPath);
}

/** Check workspace template entries for paths whose top-level directory matches a known repo name. */
export function checkWorkspaceTemplateRepoWarnings(arbRootDir: string): string[] {
  const reposDir = join(arbRootDir, ".arb", "repos");
  const repoNames = new Set(listRepos(reposDir));
  if (repoNames.size === 0) return [];

  const wsTemplateDir = join(arbRootDir, ".arb", "templates", "workspace");
  if (!existsSync(wsTemplateDir)) return [];

  const warnings: string[] = [];
  const warnedDirs = new Set<string>();

  for (const rawRelPath of walkFiles(wsTemplateDir)) {
    const relPath = isTemplateFile(rawRelPath) ? stripTemplateExt(rawRelPath) : rawRelPath;
    const topDir = relPath.split("/")[0];
    if (topDir && repoNames.has(topDir) && !warnedDirs.has(topDir)) {
      warnedDirs.add(topDir);
      warnings.push(topDir);
    }
  }

  return warnings;
}
