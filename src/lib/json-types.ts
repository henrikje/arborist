import { z } from "zod";

// ── Public JSON schemas ──
// Zod schemas are the single source of truth for the stable JSON contract.
// TypeScript types are derived via z.infer<>. JSON Schema is generated via
// toJSONSchema() for the --schema flag.

// ── Git operation (mirrors GitOperation from git.ts) ──

const GitOperationSchema = z.enum(["rebase", "merge", "cherry-pick", "revert", "bisect", "am"]).nullable();

// ── Status JSON schemas ──

export const StatusJsonRepoSchema = z.object({
	name: z.string(),
	identity: z.object({
		worktreeKind: z.enum(["full", "linked"]),
		headMode: z.union([
			z.object({ kind: z.literal("attached"), branch: z.string() }),
			z.object({ kind: z.literal("detached") }),
		]),
		shallow: z.boolean(),
	}),
	local: z.object({
		staged: z.number(),
		modified: z.number(),
		untracked: z.number(),
		conflicts: z.number(),
	}),
	base: z
		.object({
			remote: z.string().nullable(),
			ref: z.string(),
			configuredRef: z.string().nullable(),
			ahead: z.number(),
			behind: z.number(),
			mergedIntoBase: z.enum(["merge", "squash"]).nullable(),
			baseMergedIntoDefault: z.enum(["merge", "squash"]).nullable(),
		})
		.nullable(),
	share: z.object({
		remote: z.string(),
		ref: z.string().nullable(),
		refMode: z.enum(["noRef", "implicit", "configured", "gone"]),
		toPush: z.number().nullable(),
		toPull: z.number().nullable(),
		rebased: z.number().nullable(),
	}),
	operation: GitOperationSchema,
	lastCommit: z.string().nullable(),
	verbose: z
		.object({
			aheadOfBase: z.array(z.object({ hash: z.string(), subject: z.string() })).optional(),
			behindBase: z
				.array(
					z.object({
						hash: z.string(),
						subject: z.string(),
						rebaseOf: z.string().optional(),
						squashOf: z.array(z.string()).optional(),
					}),
				)
				.optional(),
			unpushed: z.array(z.object({ hash: z.string(), subject: z.string(), rebased: z.boolean() })).optional(),
			staged: z
				.array(
					z.object({
						file: z.string(),
						type: z.enum(["new file", "modified", "deleted", "renamed", "copied"]),
					}),
				)
				.optional(),
			unstaged: z.array(z.object({ file: z.string(), type: z.enum(["modified", "deleted"]) })).optional(),
			untracked: z.array(z.string()).optional(),
		})
		.optional(),
});

export const StatusJsonOutputSchema = z.object({
	workspace: z.string(),
	branch: z.string(),
	base: z.string().nullable(),
	repos: z.array(StatusJsonRepoSchema),
	total: z.number(),
	atRiskCount: z.number(),
	statusLabels: z.array(z.string()),
	lastCommit: z.string().nullable(),
});

// ── Log JSON schemas ──

const LogJsonRepoStatusSchema = z.enum(["ok", "detached", "drifted", "no-base", "fallback-base"]);

const LogJsonCommitSchema = z.object({
	hash: z.string(),
	shortHash: z.string(),
	subject: z.string(),
});

export const LogJsonRepoSchema = z.object({
	name: z.string(),
	status: LogJsonRepoStatusSchema,
	reason: z.string().optional(),
	commits: z.array(LogJsonCommitSchema),
});

export const LogJsonOutputSchema = z.object({
	workspace: z.string(),
	branch: z.string(),
	base: z.string().nullable(),
	repos: z.array(LogJsonRepoSchema),
	totalCommits: z.number(),
});

// ── Diff JSON schemas ──

const DiffJsonRepoStatusSchema = z.enum(["ok", "detached", "drifted", "no-base", "fallback-base", "clean"]);

const DiffJsonFileStatSchema = z.object({
	file: z.string(),
	insertions: z.number(),
	deletions: z.number(),
});

export const DiffJsonRepoSchema = z.object({
	name: z.string(),
	status: DiffJsonRepoStatusSchema,
	reason: z.string().optional(),
	stat: z.object({ files: z.number(), insertions: z.number(), deletions: z.number() }),
	fileStat: z.array(DiffJsonFileStatSchema).optional(),
	untrackedCount: z.number().optional(),
});

export const DiffJsonOutputSchema = z.object({
	workspace: z.string(),
	branch: z.string(),
	base: z.string().nullable(),
	repos: z.array(DiffJsonRepoSchema),
	totalFiles: z.number(),
	totalInsertions: z.number(),
	totalDeletions: z.number(),
	totalUntracked: z.number().optional(),
});

// ── Repo list JSON schema ──

export const RepoListJsonEntrySchema = z.object({
	name: z.string(),
	url: z.string(),
	share: z.object({ name: z.string(), url: z.string() }),
	base: z.object({ name: z.string(), url: z.string() }),
});

// ── List JSON schema ──

export const ListJsonEntrySchema = z.object({
	workspace: z.string(),
	active: z.boolean(),
	branch: z.string().nullable(),
	base: z.string().nullable(),
	repoCount: z.number().nullable(),
	status: z.enum(["config-missing", "empty", "error"]).nullable(),
	atRiskCount: z.number().optional(),
	statusLabels: z.array(z.string()).optional(),
	statusCounts: z.array(z.object({ label: z.string(), count: z.number() })).optional(),
	lastCommit: z.string().nullable().optional(),
});

// ── Branch JSON schema ──

export const BranchJsonOutputSchema = z.object({
	branch: z.string(),
	base: z.string().nullable(),
	repos: z.array(z.object({ name: z.string(), branch: z.string().nullable() })),
});

// ── Derived TypeScript types ──

export type StatusJsonRepo = z.infer<typeof StatusJsonRepoSchema>;
export type StatusJsonOutput = z.infer<typeof StatusJsonOutputSchema>;
export type LogJsonRepoStatus = z.infer<typeof LogJsonRepoStatusSchema>;
export type LogJsonCommit = z.infer<typeof LogJsonCommitSchema>;
export type LogJsonRepo = z.infer<typeof LogJsonRepoSchema>;
export type LogJsonOutput = z.infer<typeof LogJsonOutputSchema>;
export type DiffJsonRepoStatus = z.infer<typeof DiffJsonRepoStatusSchema>;
export type DiffJsonFileStat = z.infer<typeof DiffJsonFileStatSchema>;
export type DiffJsonRepo = z.infer<typeof DiffJsonRepoSchema>;
export type DiffJsonOutput = z.infer<typeof DiffJsonOutputSchema>;
export type RepoListJsonEntry = z.infer<typeof RepoListJsonEntrySchema>;
export type ListJsonEntry = z.infer<typeof ListJsonEntrySchema>;
export type BranchJsonOutput = z.infer<typeof BranchJsonOutputSchema>;
