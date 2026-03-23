import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { hashContent } from "./manifest";
import { collectUnknownVariables, renderTemplate } from "./render";
import {
  ARBTEMPLATE_EXT,
  type ConflictInfo,
  type FailedCopy,
  type ForceOverlayResult,
  type OverlayResult,
  type TemplateContext,
  type UnknownVariable,
} from "./types";

export function isTemplateFile(relPath: string): boolean {
  return relPath.endsWith(ARBTEMPLATE_EXT);
}

export function stripTemplateExt(relPath: string): string {
  return relPath.slice(0, -ARBTEMPLATE_EXT.length);
}

export function walkFiles(dir: string): string[] {
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

export function overlayDirectory(
  srcDir: string,
  destDir: string,
  ctx?: TemplateContext,
  tplPathPrefix?: string,
  conflictScope?: "workspace" | "repo",
  conflictRepo?: string,
  force?: false,
  dryRun?: boolean,
): OverlayResult;
export function overlayDirectory(
  srcDir: string,
  destDir: string,
  ctx: TemplateContext | undefined,
  tplPathPrefix: string | undefined,
  conflictScope: "workspace" | "repo" | undefined,
  conflictRepo: string | undefined,
  force: true,
  dryRun?: boolean,
): ForceOverlayResult;
export function overlayDirectory(
  srcDir: string,
  destDir: string,
  ctx?: TemplateContext,
  tplPathPrefix?: string,
  conflictScope?: "workspace" | "repo",
  conflictRepo?: string,
  force?: boolean,
  dryRun?: boolean,
): OverlayResult | ForceOverlayResult {
  if (!existsSync(srcDir)) return force ? emptyForceOverlayResult() : emptyOverlayResult();

  const conflicts: ConflictInfo[] = [];
  const failed: FailedCopy[] = [];
  const unknownVariables: UnknownVariable[] = [];
  const seededHashes: Record<string, string> = {};
  const seeded: string[] = [];

  // Normal mode arrays
  const skipped: string[] = [];
  const regenerated: string[] = [];
  // Force mode arrays
  const reset: string[] = [];
  const unchanged: string[] = [];

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
          conflicts.push({ scope: conflictScope ?? "workspace", repo: conflictRepo, relPath });
          continue;
        }
        seen.add(relPath);

        const destPath = join(destDir, relPath);
        const tplContent = isArbtpl && ctx ? readFileSync(srcPath, "utf-8") : null;

        if (tplContent !== null && ctx) {
          const displayPath = tplPathPrefix ? `${tplPathPrefix}/${rawRelPath}` : rawRelPath;
          unknownVariables.push(...collectUnknownVariables(tplContent, ctx, displayPath));
        }

        if (!existsSync(destPath)) {
          // New file — identical for both modes
          try {
            let content: Buffer;
            if (tplContent !== null && ctx) {
              const rendered = renderTemplate(tplContent, ctx);
              if (!dryRun) {
                mkdirSync(join(destDir, relative(srcDir, dir)), { recursive: true });
                writeFileSync(destPath, rendered);
              }
              content = Buffer.from(rendered);
            } else {
              if (!dryRun) {
                mkdirSync(join(destDir, relative(srcDir, dir)), { recursive: true });
                copyFileSync(srcPath, destPath);
              }
              content = readFileSync(srcPath);
            }
            seeded.push(relPath);
            seededHashes[relPath] = hashContent(content);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            failed.push({ path: relPath, error: msg });
          }
        } else if (force) {
          // Force mode: always overwrite if different
          try {
            const srcContent =
              tplContent !== null && ctx ? Buffer.from(renderTemplate(tplContent, ctx)) : readFileSync(srcPath);
            const destContent = readFileSync(destPath);
            if (srcContent.equals(destContent)) {
              unchanged.push(relPath);
              seededHashes[relPath] = hashContent(srcContent);
            } else {
              if (!dryRun) {
                if (tplContent !== null && ctx) {
                  writeFileSync(destPath, srcContent);
                } else {
                  copyFileSync(srcPath, destPath);
                }
              }
              reset.push(relPath);
              seededHashes[relPath] = hashContent(srcContent);
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            failed.push({ path: relPath, error: msg });
          }
        } else if (tplContent !== null && ctx?.previousRepos) {
          // Normal mode: membership change — check if file should be regenerated
          try {
            const newRender = renderTemplate(tplContent, ctx);
            const existingContent = readFileSync(destPath, "utf-8");

            if (existingContent === newRender) {
              skipped.push(relPath);
            } else {
              // Render with previous context to check for user edits
              const prevCtx: TemplateContext = { ...ctx, repos: ctx.previousRepos };
              const prevRender = renderTemplate(tplContent, prevCtx);

              if (existingContent === prevRender) {
                // User hasn't edited — safe to overwrite
                if (!dryRun) writeFileSync(destPath, newRender);
                regenerated.push(relPath);
                seededHashes[relPath] = hashContent(newRender);
              } else {
                // User has edited — don't overwrite
                skipped.push(relPath);
              }
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            failed.push({ path: relPath, error: msg });
          }
        } else {
          // Normal mode: existing file, no membership change
          skipped.push(relPath);
        }
      }
    }
  }

  walk(srcDir);

  if (force) {
    return {
      seeded,
      reset,
      unchanged,
      conflicts,
      failed,
      unknownVariables,
      repoDirectoryWarnings: [],
      seededHashes,
    } satisfies ForceOverlayResult;
  }
  return {
    seeded,
    skipped,
    regenerated,
    conflicts,
    failed,
    unknownVariables,
    repoDirectoryWarnings: [],
    seededHashes,
  } satisfies OverlayResult;
}

export function forceOverlayDirectory(
  srcDir: string,
  destDir: string,
  ctx?: TemplateContext,
  tplPathPrefix?: string,
  conflictScope?: "workspace" | "repo",
  conflictRepo?: string,
  dryRun?: boolean,
): ForceOverlayResult {
  return overlayDirectory(srcDir, destDir, ctx, tplPathPrefix, conflictScope, conflictRepo, true, dryRun);
}
