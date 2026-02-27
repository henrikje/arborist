import { dim } from "./output";

export interface ConflictEntry {
	repo: string;
	stdout: string;
	stderr: string;
	subcommand: "rebase" | "merge";
}

export function reportConflicts(entries: ConflictEntry[]): void {
	if (entries.length === 0) return;
	process.stderr.write(`\n  ${entries.length} repo(s) have conflicts:\n`);
	for (const e of entries) {
		process.stderr.write(`\n    ${e.repo}\n`);
		const combined = `${e.stdout}\n${e.stderr}`;
		for (const line of combined.split("\n").filter((l) => l.startsWith("CONFLICT"))) {
			process.stderr.write(`      ${dim(line)}\n`);
		}
		process.stderr.write(`      cd ${e.repo}\n`);
		process.stderr.write(`      # fix conflicts, then: git ${e.subcommand} --continue\n`);
		process.stderr.write(`      # or to undo: git ${e.subcommand} --abort\n`);
	}
}

export function reportStashPopFailures(repos: { repo: string }[], verb: string): void {
	if (repos.length === 0) return;
	process.stderr.write(`\n  ${repos.length} repo(s) need manual stash application:\n`);
	for (const r of repos) {
		process.stderr.write(`\n    ${r.repo}\n`);
		process.stderr.write(`      ${verb} succeeded, but stash pop conflicted.\n`);
		process.stderr.write(`      cd ${r.repo}\n`);
		process.stderr.write("      git stash pop    # re-apply and resolve conflicts\n");
		process.stderr.write("      # or: git stash show  # inspect stashed changes\n");
	}
}
