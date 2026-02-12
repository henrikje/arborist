import { $ } from "bun";

const sha = (await $`git rev-parse --short HEAD`.text()).trim();
const dirty = (await $`git status --porcelain`.text()).trim().length > 0;
const version = dirty ? `build-${sha}-modified` : `build-${sha}`;

await Bun.write(
	"src/version.ts",
	`// Generated at build time — do not edit.\nexport const ARB_VERSION = "${version}";\n`,
);
