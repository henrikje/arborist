import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

const tag = process.argv[2];
if (!tag) {
	console.error("Usage: bun run scripts/update-homebrew.ts <tag>");
	process.exit(1);
}

const version = tag.replace(/^v/, "");
const token = process.env.HOMEBREW_TAP_TOKEN;
if (!token) {
	console.error("HOMEBREW_TAP_TOKEN environment variable is required");
	process.exit(1);
}

// Read checksums
const checksumContent = await readFile("dist/checksums.txt", "utf-8");
const checksums = new Map<string, string>();
for (const line of checksumContent.trim().split("\n")) {
	const [sha256, filename] = line.split(/\s+/);
	if (sha256 && filename) {
		checksums.set(filename, sha256);
	}
}

function getChecksum(os: string, arch: string): string {
	const filename = `arb-${version}-${os}-${arch}.tar.gz`;
	const sha256 = checksums.get(filename);
	if (!sha256) {
		console.error(`Missing checksum for ${filename}`);
		process.exit(1);
	}
	return sha256;
}

// Read formula template
const template = await readFile("homebrew/arb.rb", "utf-8");

// Replace placeholders
const formula = template
	.replaceAll("VERSION", version)
	.replace("SHA256_DARWIN_ARM64", getChecksum("darwin", "arm64"))
	.replace("SHA256_DARWIN_X64", getChecksum("darwin", "x64"))
	.replace("SHA256_LINUX_ARM64", getChecksum("linux", "arm64"))
	.replace("SHA256_LINUX_X64", getChecksum("linux", "x64"));

// Clone tap repo, update formula, push
const tapDir = join(tmpdir(), `homebrew-tap-${Date.now()}`);
await $`git clone https://x-access-token:${token}@github.com/henrikje/homebrew-tap.git ${tapDir}`;
await Bun.write(join(tapDir, "Formula", "arb.rb"), formula);

const commitMessage = `arb ${version}`;
await $`git -C ${tapDir} add Formula/arb.rb`;
await $`git -C ${tapDir} -c user.name=github-actions -c user.email=github-actions@github.com commit -m ${commitMessage}`;
await $`git -C ${tapDir} push`;

// Clean up
await $`rm -rf ${tapDir}`;

console.log(`Updated homebrew-tap formula to ${version}`);
