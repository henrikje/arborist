import { existsSync, readFileSync, writeFileSync } from "node:fs";

export function configGet(configFile: string, key: string): string | null {
  if (!existsSync(configFile)) return null;
  const content = readFileSync(configFile, "utf-8");
  const prefix = `${key} = `;
  return (
    content
      .split("\n")
      .find((line) => line.startsWith(prefix))
      ?.slice(prefix.length) ?? null
  );
}

export function configGetList(configFile: string, key: string): string[] {
  const value = configGet(configFile, key);
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function configSetList(configFile: string, key: string, values: string[]): void {
  const line = values.length > 0 ? `${key} = ${values.join(",")}` : null;
  const prefix = `${key} = `;

  if (existsSync(configFile)) {
    const lines = readFileSync(configFile, "utf-8").split("\n");
    const idx = lines.findIndex((l) => l.startsWith(prefix));
    if (idx !== -1) {
      if (line) {
        lines[idx] = line;
      } else {
        lines.splice(idx, 1);
      }
    } else if (line) {
      // Remove trailing empty line before appending
      if (lines.at(-1) === "") lines.pop();
      lines.push(line);
    }
    writeFileSync(configFile, `${lines.join("\n")}\n`.replace(/\n{2,}$/, "\n"));
  } else if (line) {
    writeFileSync(configFile, `${line}\n`);
  }
}

export function writeConfig(
  configFile: string,
  branch: string,
  base?: string | null,
  branchRenameFrom?: string | null,
  workspaceRenameTo?: string | null,
): void {
  let content = `branch = ${branch}\n`;
  if (base) content += `base = ${base}\n`;
  if (branchRenameFrom) content += `branch_rename_from = ${branchRenameFrom}\n`;
  if (workspaceRenameTo) content += `workspace_rename_to = ${workspaceRenameTo}\n`;
  writeFileSync(configFile, content);
}
