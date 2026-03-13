import { basename } from "node:path";
import { ArbError } from "../core/errors";
import type { GitCache } from "../git/git-cache";
import { error } from "../terminal/output";
import { workspaceRepoDirs } from "./repos";

export interface WorkspaceBaseResolution {
  baseRemotes: Set<string>;
}

export function rejectExplicitBaseRemotePrefix(
  value: string | null,
  resolution: WorkspaceBaseResolution,
): string | null {
  if (!value) return null;
  if (resolution.baseRemotes.size !== 1) return value;

  const [baseRemote = ""] = [...resolution.baseRemotes];
  const prefix = `${baseRemote}/`;
  if (!value.startsWith(prefix) || value.length <= prefix.length) return value;
  const branch = value.slice(prefix.length);

  throwBaseError(`Base branch '${value}' includes the resolved base remote '${baseRemote}'. Use '${branch}' instead.`);
}

export async function resolveWorkspaceBaseResolution(
  wsDir: string,
  reposDir: string,
  cache: GitCache,
): Promise<WorkspaceBaseResolution> {
  const repoDirs = workspaceRepoDirs(wsDir);
  const baseRemotes = new Set<string>();

  await Promise.all(
    repoDirs.map(async (repoDir) => {
      const repo = basename(repoDir);
      const canonicalPath = `${reposDir}/${repo}`;
      const remotes = await cache.resolveRemotes(canonicalPath);
      baseRemotes.add(remotes.base);
    }),
  );

  return { baseRemotes };
}

function throwBaseError(message: string): never {
  error(message);
  throw new ArbError(message);
}
