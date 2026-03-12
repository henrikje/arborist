import { Liquid } from "liquidjs";
import type { TemplateContext, UnknownVariable } from "./types";

const liquid = new Liquid({ strictVariables: false });

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
    project: { path: ctx.rootPath },
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
  const paths = new Set(["project.path", "workspace.name", "workspace.path", "workspace.repos"]);
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

export function collectUnknownVariables(content: string, ctx: TemplateContext, filePath: string): UnknownVariable[] {
  return checkUnknownVariables(content, ctx).map((varName) => ({ varName, filePath }));
}
