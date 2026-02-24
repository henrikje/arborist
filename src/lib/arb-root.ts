import { existsSync } from "node:fs";
import { dirname } from "node:path";

export function detectArbRoot(startDir?: string): string | null {
	let dir = startDir ?? process.cwd();
	while (dir !== "/") {
		if (existsSync(`${dir}/.arb`)) {
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

export function detectWorkspace(arbRootDir: string): string | null {
	const cwd = process.cwd();
	const prefix = `${arbRootDir}/`;
	if (!cwd.startsWith(prefix)) return null;
	const firstSegment = cwd.slice(prefix.length).split("/")[0];
	if (!firstSegment) return null;
	if (existsSync(`${arbRootDir}/${firstSegment}/.arbws`)) {
		return firstSegment;
	}
	return null;
}
