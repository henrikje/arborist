import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function loadArbIgnore(baseDir: string): Set<string> {
	const ignoreFile = join(baseDir, ".arbignore");
	if (!existsSync(ignoreFile)) return new Set();
	const content = readFileSync(ignoreFile, "utf-8");
	const names = new Set<string>();
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (trimmed && !trimmed.startsWith("#")) {
			names.add(trimmed);
		}
	}
	return names;
}
