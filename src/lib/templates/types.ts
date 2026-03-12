export const ARBTEMPLATE_EXT = ".arbtemplate";

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

export interface FailedCopy {
  path: string;
  error: string;
}

export interface ConflictInfo {
  scope: "workspace" | "repo";
  repo?: string;
  relPath: string;
}

export interface OverlayResult {
  seeded: string[];
  skipped: string[];
  regenerated: string[];
  conflicts: ConflictInfo[];
  failed: FailedCopy[];
  unknownVariables: UnknownVariable[];
  repoDirectoryWarnings: string[];
  seededHashes: Record<string, string>;
}

export interface ForceOverlayResult {
  seeded: string[];
  reset: string[];
  unchanged: string[];
  conflicts: ConflictInfo[];
  failed: FailedCopy[];
  unknownVariables: UnknownVariable[];
  repoDirectoryWarnings: string[];
  seededHashes: Record<string, string>;
}

export interface TemplateDiff {
  relPath: string;
  scope: "workspace" | "repo";
  repo?: string;
  kind: "modified" | "deleted" | "stale";
}

export interface TemplateEntry {
  scope: "workspace" | "repo";
  repo?: string;
  relPath: string;
  isTemplate?: boolean;
  conflict?: boolean;
}

export interface TemplateScope {
  scope: "workspace" | "repo";
  repo?: string;
}
