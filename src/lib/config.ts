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

export function writeConfig(
	configFile: string,
	branch: string,
	base?: string | null,
	branchRenameFrom?: string | null,
): void {
	let content = `branch = ${branch}\n`;
	if (base) content += `base = ${base}\n`;
	if (branchRenameFrom) content += `branch_rename_from = ${branchRenameFrom}\n`;
	writeFileSync(configFile, content);
}
