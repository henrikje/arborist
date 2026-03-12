export interface FileChange {
  file: string;
  type: "new file" | "modified" | "deleted" | "renamed" | "copied";
}

export function stagedType(code: string): FileChange["type"] {
  switch (code) {
    case "A":
      return "new file";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    default:
      return "modified";
  }
}

export function unstagedType(code: string): FileChange["type"] {
  switch (code) {
    case "D":
      return "deleted";
    default:
      return "modified";
  }
}

export function parseGitNumstat(output: string): { file: string; insertions: number; deletions: number }[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      if (parts.length < 3) return null;
      const [ins, del, ...fileParts] = parts;
      const file = fileParts.join("\t"); // Handle filenames with tabs (renames show as "old => new")
      // Binary files show as "-\t-\tfile"
      return {
        file: file ?? "",
        insertions: ins === "-" ? 0 : Number.parseInt(ins ?? "0", 10),
        deletions: del === "-" ? 0 : Number.parseInt(del ?? "0", 10),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

export function parseDiffShortstat(output: string): { files: number; insertions: number; deletions: number } | null {
  const trimmed = output.trim();
  if (!trimmed) return null;
  const files = trimmed.match(/(\d+) files? changed/);
  const ins = trimmed.match(/(\d+) insertions?\(\+\)/);
  const del = trimmed.match(/(\d+) deletions?\(-\)/);
  if (!files) return null;
  return {
    files: Number.parseInt(files[1] ?? "0", 10),
    insertions: ins ? Number.parseInt(ins[1] ?? "0", 10) : 0,
    deletions: del ? Number.parseInt(del[1] ?? "0", 10) : 0,
  };
}

export interface GitVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseGitVersion(output: string): GitVersion | null {
  const match = output.match(/git version (\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  const major = match[1];
  const minor = match[2];
  const patch = match[3];
  if (!major || !minor || !patch) return null;
  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
  };
}
