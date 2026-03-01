/** Remote URL parsing and PR URL construction — pure functions, no I/O. */

export type RemoteProvider = "github" | "gitlab" | "bitbucket" | "azure-devops" | "unknown";

export interface ParsedRemoteUrl {
	provider: RemoteProvider;
	host: string;
	owner: string;
	repo: string;
	/** Azure DevOps project — only present for azure-devops provider. */
	project?: string;
	/** Azure DevOps org — only present for azure-devops provider. */
	org?: string;
}

/** Known host → provider mapping. */
function providerFromHost(host: string): RemoteProvider {
	if (host === "github.com") return "github";
	if (host === "gitlab.com") return "gitlab";
	if (host === "bitbucket.org") return "bitbucket";
	if (host === "dev.azure.com" || host === "ssh.dev.azure.com") return "azure-devops";
	return "unknown";
}

/** Strip trailing `.git` from a path segment. */
function stripDotGit(s: string): string {
	return s.endsWith(".git") ? s.slice(0, -4) : s;
}

/**
 * Parse a git remote URL into structured components.
 *
 * Supports:
 * - SSH:   `git@host:owner/repo.git`
 * - HTTPS: `https://host/owner/repo.git`
 * - SSH protocol: `ssh://git@host/owner/repo.git`
 * - Azure DevOps SSH: `git@ssh.dev.azure.com:v3/org/project/repo`
 * - Azure DevOps HTTPS: `https://org@dev.azure.com/org/project/_git/repo`
 */
export function parseRemoteUrl(url: string): ParsedRemoteUrl | null {
	if (!url) return null;

	// ── Azure DevOps SSH: git@ssh.dev.azure.com:v3/org/project/repo ──
	const adoSshMatch = url.match(/^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/);
	if (adoSshMatch) {
		const [, org, project, repo] = adoSshMatch;
		if (!org || !project || !repo) return null;
		return { provider: "azure-devops", host: "dev.azure.com", owner: org, repo, org, project };
	}

	// ── Azure DevOps HTTPS: https://org@dev.azure.com/org/project/_git/repo ──
	const adoHttpsMatch = url.match(/^https?:\/\/[^@]*@?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/(.+?)(?:\.git)?$/);
	if (adoHttpsMatch) {
		const [, org, project, repo] = adoHttpsMatch;
		if (!org || !project || !repo) return null;
		return { provider: "azure-devops", host: "dev.azure.com", owner: org, repo, org, project };
	}

	// ── Standard SSH: git@host:owner/repo.git ──
	const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
	if (sshMatch) {
		const [, host, path] = sshMatch;
		if (!host || !path) return null;
		const parts = path.split("/");
		if (parts.length < 2) return null;
		const repo = parts[parts.length - 1];
		const owner = parts.slice(0, -1).join("/");
		if (!owner || !repo) return null;
		return { provider: providerFromHost(host), host, owner, repo };
	}

	// ── SSH protocol: ssh://git@host/owner/repo.git ──
	// ── HTTPS: https://host/owner/repo.git ──
	try {
		const parsed = new URL(url);
		const host = parsed.hostname;
		if (!host) return null;
		// Remove leading slash and trailing .git
		const path = stripDotGit(parsed.pathname.replace(/^\//, ""));
		const parts = path.split("/");
		if (parts.length < 2) return null;
		const repo = parts[parts.length - 1];
		const owner = parts.slice(0, -1).join("/");
		if (!owner || !repo) return null;
		return { provider: providerFromHost(host), host, owner, repo };
	} catch {
		return null;
	}
}

/**
 * Construct a PR/MR URL for a known provider. Returns null for unknown hosts.
 */
export function buildPrUrl(parsed: ParsedRemoteUrl, prNumber: number): string | null {
	switch (parsed.provider) {
		case "github":
			return `https://${parsed.host}/${parsed.owner}/${parsed.repo}/pull/${prNumber}`;
		case "gitlab":
			return `https://${parsed.host}/${parsed.owner}/${parsed.repo}/-/merge_requests/${prNumber}`;
		case "bitbucket":
			return `https://${parsed.host}/${parsed.owner}/${parsed.repo}/pull-requests/${prNumber}`;
		case "azure-devops":
			if (parsed.org && parsed.project) {
				return `https://${parsed.host}/${parsed.org}/${parsed.project}/_git/${parsed.repo}/pullrequest/${prNumber}`;
			}
			return null;
		default:
			return null;
	}
}
