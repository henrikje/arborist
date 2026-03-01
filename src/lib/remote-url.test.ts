import { describe, expect, test } from "bun:test";
import { type ParsedRemoteUrl, buildPrUrl, parseRemoteUrl } from "./remote-url";

describe("parseRemoteUrl", () => {
	describe("GitHub", () => {
		test("SSH", () => {
			expect(parseRemoteUrl("git@github.com:acme/frontend.git")).toEqual({
				provider: "github",
				host: "github.com",
				owner: "acme",
				repo: "frontend",
			});
		});

		test("SSH without .git", () => {
			expect(parseRemoteUrl("git@github.com:acme/frontend")).toEqual({
				provider: "github",
				host: "github.com",
				owner: "acme",
				repo: "frontend",
			});
		});

		test("HTTPS", () => {
			expect(parseRemoteUrl("https://github.com/acme/frontend.git")).toEqual({
				provider: "github",
				host: "github.com",
				owner: "acme",
				repo: "frontend",
			});
		});

		test("HTTPS without .git", () => {
			expect(parseRemoteUrl("https://github.com/acme/frontend")).toEqual({
				provider: "github",
				host: "github.com",
				owner: "acme",
				repo: "frontend",
			});
		});

		test("SSH protocol", () => {
			expect(parseRemoteUrl("ssh://git@github.com/acme/frontend.git")).toEqual({
				provider: "github",
				host: "github.com",
				owner: "acme",
				repo: "frontend",
			});
		});
	});

	describe("GitLab", () => {
		test("SSH", () => {
			expect(parseRemoteUrl("git@gitlab.com:acme/frontend.git")).toEqual({
				provider: "gitlab",
				host: "gitlab.com",
				owner: "acme",
				repo: "frontend",
			});
		});

		test("HTTPS", () => {
			expect(parseRemoteUrl("https://gitlab.com/acme/frontend.git")).toEqual({
				provider: "gitlab",
				host: "gitlab.com",
				owner: "acme",
				repo: "frontend",
			});
		});

		test("nested group", () => {
			expect(parseRemoteUrl("git@gitlab.com:acme/sub-group/frontend.git")).toEqual({
				provider: "gitlab",
				host: "gitlab.com",
				owner: "acme/sub-group",
				repo: "frontend",
			});
		});
	});

	describe("Bitbucket", () => {
		test("SSH", () => {
			expect(parseRemoteUrl("git@bitbucket.org:acme/frontend.git")).toEqual({
				provider: "bitbucket",
				host: "bitbucket.org",
				owner: "acme",
				repo: "frontend",
			});
		});

		test("HTTPS", () => {
			expect(parseRemoteUrl("https://bitbucket.org/acme/frontend.git")).toEqual({
				provider: "bitbucket",
				host: "bitbucket.org",
				owner: "acme",
				repo: "frontend",
			});
		});
	});

	describe("Azure DevOps", () => {
		test("SSH", () => {
			expect(parseRemoteUrl("git@ssh.dev.azure.com:v3/acme/MyProject/frontend")).toEqual({
				provider: "azure-devops",
				host: "dev.azure.com",
				owner: "acme",
				repo: "frontend",
				org: "acme",
				project: "MyProject",
			});
		});

		test("SSH with .git", () => {
			expect(parseRemoteUrl("git@ssh.dev.azure.com:v3/acme/MyProject/frontend.git")).toEqual({
				provider: "azure-devops",
				host: "dev.azure.com",
				owner: "acme",
				repo: "frontend",
				org: "acme",
				project: "MyProject",
			});
		});

		test("HTTPS", () => {
			expect(parseRemoteUrl("https://acme@dev.azure.com/acme/MyProject/_git/frontend")).toEqual({
				provider: "azure-devops",
				host: "dev.azure.com",
				owner: "acme",
				repo: "frontend",
				org: "acme",
				project: "MyProject",
			});
		});

		test("HTTPS without auth prefix", () => {
			expect(parseRemoteUrl("https://dev.azure.com/acme/MyProject/_git/frontend")).toEqual({
				provider: "azure-devops",
				host: "dev.azure.com",
				owner: "acme",
				repo: "frontend",
				org: "acme",
				project: "MyProject",
			});
		});
	});

	describe("unknown host", () => {
		test("self-hosted SSH", () => {
			expect(parseRemoteUrl("git@git.internal.co:team/repo.git")).toEqual({
				provider: "unknown",
				host: "git.internal.co",
				owner: "team",
				repo: "repo",
			});
		});

		test("self-hosted HTTPS", () => {
			expect(parseRemoteUrl("https://git.internal.co/team/repo.git")).toEqual({
				provider: "unknown",
				host: "git.internal.co",
				owner: "team",
				repo: "repo",
			});
		});
	});

	describe("edge cases", () => {
		test("empty string returns null", () => {
			expect(parseRemoteUrl("")).toBeNull();
		});

		test("garbage returns null", () => {
			expect(parseRemoteUrl("not-a-url")).toBeNull();
		});

		test("host-only URL returns null", () => {
			expect(parseRemoteUrl("https://github.com/")).toBeNull();
		});
	});
});

describe("buildPrUrl", () => {
	test("GitHub", () => {
		const parsed: ParsedRemoteUrl = { provider: "github", host: "github.com", owner: "acme", repo: "frontend" };
		expect(buildPrUrl(parsed, 123)).toBe("https://github.com/acme/frontend/pull/123");
	});

	test("GitLab", () => {
		const parsed: ParsedRemoteUrl = { provider: "gitlab", host: "gitlab.com", owner: "acme", repo: "frontend" };
		expect(buildPrUrl(parsed, 42)).toBe("https://gitlab.com/acme/frontend/-/merge_requests/42");
	});

	test("Bitbucket", () => {
		const parsed: ParsedRemoteUrl = {
			provider: "bitbucket",
			host: "bitbucket.org",
			owner: "acme",
			repo: "frontend",
		};
		expect(buildPrUrl(parsed, 7)).toBe("https://bitbucket.org/acme/frontend/pull-requests/7");
	});

	test("Azure DevOps", () => {
		const parsed: ParsedRemoteUrl = {
			provider: "azure-devops",
			host: "dev.azure.com",
			owner: "acme",
			repo: "frontend",
			org: "acme",
			project: "MyProject",
		};
		expect(buildPrUrl(parsed, 99)).toBe("https://dev.azure.com/acme/MyProject/_git/frontend/pullrequest/99");
	});

	test("unknown provider returns null", () => {
		const parsed: ParsedRemoteUrl = {
			provider: "unknown",
			host: "git.internal.co",
			owner: "team",
			repo: "repo",
		};
		expect(buildPrUrl(parsed, 1)).toBeNull();
	});

	test("GitHub with nested owner", () => {
		const parsed: ParsedRemoteUrl = {
			provider: "gitlab",
			host: "gitlab.com",
			owner: "acme/sub-group",
			repo: "frontend",
		};
		expect(buildPrUrl(parsed, 5)).toBe("https://gitlab.com/acme/sub-group/frontend/-/merge_requests/5");
	});
});
