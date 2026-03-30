import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { GitCache } from "../git/git-cache";
import { hashContent, manifestKey, readManifest } from "./manifest";
import { isTemplateFile, stripTemplateExt } from "./overlay";
import { renderTemplate } from "./render";
import { workspaceRepoList } from "./templates";
import type { TemplateContext, TemplateDiff } from "./types";

interface DiffDirectoryResult {
  modified: string[];
  deleted: string[];
  stale: string[];
}

function diffDirectory(
  srcDir: string,
  destDir: string,
  ctx?: TemplateContext,
  manifest?: Record<string, string>,
  manifestKeyFn?: (relPath: string) => string,
): DiffDirectoryResult {
  if (!existsSync(srcDir)) return { modified: [], deleted: [], stale: [] };

  const modified: string[] = [];
  const deleted: string[] = [];
  const stale: string[] = [];
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
          // Check manifest: if workspace file matches its seeded hash, the user hasn't touched it
          if (manifest && manifestKeyFn) {
            const seededHash = manifest[manifestKeyFn(relPath)];
            if (seededHash && hashContent(destContent) === seededHash) {
              stale.push(relPath);
              continue;
            }
          }
          modified.push(relPath);
        }
      }
    }
  }

  walk(srcDir);
  return { modified, deleted, stale };
}

export async function diffTemplates(
  arbRootDir: string,
  wsDir: string,
  repos: string[],
  cache?: GitCache,
): Promise<TemplateDiff[]> {
  const result: TemplateDiff[] = [];
  const reposDir = join(arbRootDir, ".arb", "repos");
  const c = cache ?? new GitCache();
  const allRepos = await workspaceRepoList(wsDir, reposDir, c);
  const manifest = readManifest(wsDir);

  const wsTemplateDir = join(arbRootDir, ".arb", "templates", "workspace");
  const wsCtx: TemplateContext = {
    rootPath: arbRootDir,
    workspaceName: basename(wsDir),
    workspacePath: wsDir,
    repos: allRepos,
  };
  const wsDiffs = diffDirectory(wsTemplateDir, wsDir, wsCtx, manifest, (relPath) => manifestKey("workspace", relPath));
  for (const relPath of wsDiffs.modified) {
    result.push({ relPath, scope: "workspace", kind: "modified" });
  }
  for (const relPath of wsDiffs.deleted) {
    result.push({ relPath, scope: "workspace", kind: "deleted" });
  }
  for (const relPath of wsDiffs.stale) {
    result.push({ relPath, scope: "workspace", kind: "stale" });
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
    const repoDiffs = diffDirectory(repoTemplateDir, repoDir, repoCtx, manifest, (relPath) =>
      manifestKey("repo", relPath, repo),
    );
    for (const relPath of repoDiffs.modified) {
      result.push({ relPath, scope: "repo", repo, kind: "modified" });
    }
    for (const relPath of repoDiffs.deleted) {
      result.push({ relPath, scope: "repo", repo, kind: "deleted" });
    }
    for (const relPath of repoDiffs.stale) {
      result.push({ relPath, scope: "repo", repo, kind: "stale" });
    }
  }

  return result;
}
