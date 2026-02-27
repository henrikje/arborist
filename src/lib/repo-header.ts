import { bold, boldLine, dim, yellow } from "./output";
import type { RepoFlags, RepoStatus } from "./status";

/**
 * Check for detached/drifted skip conditions and write skip header if applicable.
 * Returns true if the repo was skipped (caller should `continue`).
 */
export function writeRepoSkipHeader(repo: RepoStatus, branch: string, flags: RepoFlags, isLast: boolean): boolean {
	if (flags.isDetached) {
		process.stderr.write(`${bold(`==> ${repo.name} <==`)} ${yellow("detached \u2014 skipping")}\n`);
		if (!isLast) process.stderr.write("\n");
		return true;
	}

	if (flags.isDrifted && repo.identity.headMode.kind === "attached") {
		const actual = repo.identity.headMode.branch;
		process.stderr.write(
			`${bold(`==> ${repo.name} <==`)} ${yellow(`on ${actual}, expected ${branch} \u2014 skipping`)}\n`,
		);
		if (!isLast) process.stderr.write("\n");
		return true;
	}

	return false;
}

/**
 * Write the `==> name <==` header with an optional dim note.
 */
export function writeRepoHeader(name: string, note?: string): void {
	if (note) {
		process.stderr.write(`${bold(`==> ${name} <==`)} ${dim(note)}\n`);
	} else {
		boldLine(`==> ${name} <==`);
	}
}

/**
 * Write a simple repo section header (no skip checks, no note).
 */
export function writeRepoHeaderSimple(name: string): void {
	boldLine(`==> ${name} <==`);
}
