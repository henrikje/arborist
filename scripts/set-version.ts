import { $ } from "bun";

const sha = (await $`git rev-parse --short HEAD`.text()).trim();
const dirty = (await $`git status --porcelain`.text()).trim().length > 0;

let baseVersion = "0.0.0";
try {
	const tag = (await $`git describe --tags --abbrev=0 --match "v*"`.text()).trim();
	baseVersion = tag.replace(/^v/, "");
} catch {
	// No tags yet
}

let exactTag = false;
try {
	const desc = (await $`git describe --tags --exact-match --match "v*"`.text()).trim();
	exactTag = desc === `v${baseVersion}`;
} catch {
	// Not exactly on a tag
}

let fullVersion: string;
if (exactTag && !dirty) {
	fullVersion = baseVersion;
} else if (dirty) {
	fullVersion = `${baseVersion}+${sha}.dirty`;
} else {
	fullVersion = `${baseVersion}+${sha}`;
}

await Bun.write(
	"src/version.ts",
	`// Generated at build time — do not edit.\nexport const ARB_VERSION = "${fullVersion}";\n`,
);
