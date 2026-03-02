import {
	EMPTY_CELL,
	type OutputNode,
	type TableColumnDef,
	type TableNode,
	type TableRow,
	analyzeBaseDiff,
	analyzeBaseName,
	analyzeBranch,
	analyzeLocal,
	analyzeRemoteDiff,
	analyzeRemoteName,
	cell,
} from "./render-model";
import { type WorkspaceSummary, computeFlags } from "./status";
import { type RelativeTimeParts, formatRelativeTimeParts } from "./time";

export interface StatusViewContext {
	/** The expected branch name for this workspace */
	expectedBranch: string;
	/** Set of repo names that have predicted merge conflicts */
	conflictRepos: Set<string>;
	/** Name of the repo the user is currently cd'd into, if any */
	currentRepo: string | null;
}

/** Build the declarative OutputNode[] for the status table */
export function buildStatusView(summary: WorkspaceSummary, ctx: StatusViewContext): OutputNode[] {
	const repos = summary.repos;

	if (repos.length === 0) {
		return [{ kind: "message", level: "muted", text: "(no repos)" }];
	}

	// Determine if BRANCH column is needed
	const showBranch = repos.some(
		(r) =>
			r.identity.headMode.kind === "detached" ||
			(r.identity.headMode.kind === "attached" && r.identity.headMode.branch !== ctx.expectedBranch),
	);

	// Pre-compute last commit parts for column group alignment
	const lastCommitParts: RelativeTimeParts[] = repos.map((r) =>
		r.lastCommit ? formatRelativeTimeParts(r.lastCommit) : { num: "", unit: "" },
	);
	// Build rows
	const rows: TableRow[] = repos.map((repo, i) => {
		const flags = computeFlags(repo, ctx.expectedBranch);
		const hasConflict = ctx.conflictRepos.has(repo.name);
		const lc = lastCommitParts[i] ?? { num: "", unit: "" };

		return {
			cells: {
				repo: cell(repo.name),
				branch: analyzeBranch(repo, ctx.expectedBranch),
				baseName: analyzeBaseName(repo, flags),
				baseDiff: analyzeBaseDiff(repo, flags, hasConflict),
				remoteName: analyzeRemoteName(repo, flags),
				remoteDiff: analyzeRemoteDiff(repo, flags),
				local: analyzeLocal(repo),
				lastCommitNum: lc.num ? cell(lc.num) : EMPTY_CELL,
				lastCommitUnit: lc.unit ? cell(lc.unit) : EMPTY_CELL,
			},
			marked: repo.name === ctx.currentRepo,
		};
	});

	// Build column definitions
	const columns: TableColumnDef[] = [
		{ header: "REPO", key: "repo" },
		{ header: "BRANCH", key: "branch", show: showBranch },
		{ header: "", key: "lastCommitNum", group: "LAST COMMIT", align: "right" as const },
		{ header: "", key: "lastCommitUnit", group: "LAST COMMIT" },
		{ header: "", key: "baseName", group: "BASE" },
		{ header: "", key: "baseDiff", group: "BASE" },
		{ header: "", key: "remoteName", group: "SHARE", truncate: { min: 10 } },
		{ header: "", key: "remoteDiff", group: "SHARE" },
		{ header: "LOCAL", key: "local" },
	];

	const table: TableNode = { kind: "table", columns, rows };
	return [table];
}
