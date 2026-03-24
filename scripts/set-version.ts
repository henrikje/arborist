import { $ } from "bun";
import { buildVersion } from "../src/lib/core/version";

const sha = (await $`git rev-parse --short HEAD`.text()).trim();
const dirty = (await $`git status --porcelain`.text()).trim().length > 0;
const buildTime = new Date().toISOString();

let tag: string | null;
try {
  tag = (await $`git describe --tags --exact-match --match "v*"`.text()).trim();
} catch {
  tag = null;
}

const { version } = buildVersion({ tag, dirty, sha, buildTime });

await Bun.write(
  "src/version.ts",
  `// Generated at build time — do not edit.\nexport const ARB_VERSION = "${version}";\n`,
);
