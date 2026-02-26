import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";

const targets = [
	{ bun: "bun-darwin-arm64", os: "darwin", arch: "arm64" },
	{ bun: "bun-darwin-x64", os: "darwin", arch: "x64" },
	{ bun: "bun-linux-x64", os: "linux", arch: "x64" },
	{ bun: "bun-linux-arm64", os: "linux", arch: "arm64" },
] as const;

const shellFiles = ["shell/arb.zsh", "shell/arb.bash"];

// Stamp version into src/version.ts
await $`bun run scripts/set-version.ts`;

// Read the stamped version
const versionFile = await readFile("src/version.ts", "utf-8");
const match = versionFile.match(/ARB_VERSION = "(.+)"/);
if (!match?.[1]) {
	console.error("Failed to read version from src/version.ts");
	process.exit(1);
}
const version = match[1];
console.log(`Building arb ${version}`);

await mkdir("dist", { recursive: true });

const checksums: string[] = [];

for (const target of targets) {
	const binaryName = "arb";
	const stagingDir = join("dist", `arb-${version}-${target.os}-${target.arch}`);
	const tarball = join("dist", `arb-${version}-${target.os}-${target.arch}.tar.gz`);

	await mkdir(stagingDir, { recursive: true });

	console.log(`Compiling for ${target.bun}...`);
	await $`bun build src/index.ts --compile --target=${target.bun} --outfile ${join(stagingDir, binaryName)}`;

	// Copy shell integration files
	await $`mkdir -p ${join(stagingDir, "shell")}`;
	for (const file of shellFiles) {
		await $`cp ${file} ${join(stagingDir, "shell")}/`;
	}

	console.log(`Packaging ${tarball}...`);
	await $`tar -czf ${tarball} -C dist ${`arb-${version}-${target.os}-${target.arch}`}`;

	// Compute checksum using Bun's native crypto
	const tarballBytes = await Bun.file(tarball).arrayBuffer();
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(tarballBytes);
	const sha256 = hasher.digest("hex");
	checksums.push(`${sha256}  arb-${version}-${target.os}-${target.arch}.tar.gz`);

	// Clean up staging directory
	await $`rm -rf ${stagingDir}`;
}

// Restore src/version.ts
await $`git checkout src/version.ts`;

// Write checksums
const checksumFile = join("dist", "checksums.txt");
await Bun.write(checksumFile, `${checksums.join("\n")}\n`);
console.log(`Checksums written to ${checksumFile}`);

console.log("Release build complete.");
