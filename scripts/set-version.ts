import { $ } from "bun";

// Find the latest v* tag, if any.
let baseVersion = { major: 0, minor: 0, patch: 0 };
let commitRange: string;

try {
	const desc = (await $`git describe --tags --abbrev=0 --match "v*"`.text()).trim();
	const m = desc.match(/^v(\d+)\.(\d+)\.(\d+)$/);
	if (m) {
		baseVersion = { major: +m[1], minor: +m[2], patch: +m[3] };
	}
	commitRange = `${desc}..HEAD`;
} catch {
	// No tags — scan entire history from 0.0.0.
	commitRange = "";
}

// Get commits oldest-to-newest (subject lines only).
const logCmd = commitRange ? $`git log --format=%s --reverse ${commitRange}` : $`git log --format=%s --reverse`;
const logOutput = (await logCmd.text()).trim();
const subjects = logOutput ? logOutput.split("\n") : [];

// Walk commits and apply bumps sequentially.
let { major, minor, patch } = baseVersion;
for (const subject of subjects) {
	if (/^[^:]+!:/.test(subject) || /BREAKING CHANGE/.test(subject)) {
		major++;
		minor = 0;
		patch = 0;
	} else if (/^feat(\(.+\))?:/.test(subject)) {
		minor++;
		patch = 0;
	} else if (/^fix(\(.+\))?:/.test(subject)) {
		patch++;
	}
	// chore, docs, refactor, etc. → no bump
}

const version = `${major}.${minor}.${patch}`;

// Determine suffix.
const sha = (await $`git rev-parse --short HEAD`.text()).trim();
const dirty = (await $`git status --porcelain`.text()).trim().length > 0;

let exactTag = false;
try {
	const desc = (await $`git describe --tags --exact-match --match "v*"`.text()).trim();
	exactTag = desc === `v${version}`;
} catch {
	// Not exactly on a tag.
}

let fullVersion: string;
if (exactTag && !dirty) {
	fullVersion = version;
} else if (dirty) {
	fullVersion = `${version}+${sha}.dirty`;
} else {
	fullVersion = `${version}+${sha}`;
}

await Bun.write(
	"src/version.ts",
	`// Generated at build time — do not edit.\nexport const ARB_VERSION = "${fullVersion}";\n`,
);
