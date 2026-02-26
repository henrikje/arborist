import { $ } from "bun";

const sha = (await $`git rev-parse --short HEAD`.text()).trim();
const dirty = (await $`git status --porcelain`.text()).trim().length > 0;

let fullVersion: string;

try {
	const tag = (await $`git describe --tags --exact-match --match "v*"`.text()).trim();
	if (!dirty) {
		fullVersion = tag.replace(/^v/, "");
	} else {
		fullVersion = `dev.${sha}.dirty`;
	}
} catch {
	fullVersion = dirty ? `dev.${sha}.dirty` : `dev.${sha}`;
}

await Bun.write(
	"src/version.ts",
	`// Generated at build time — do not edit.\nexport const ARB_VERSION = "${fullVersion}";\n`,
);
