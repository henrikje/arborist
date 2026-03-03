#!/bin/sh
set -e

echo "=== git version ==="
git --version
echo "=== bun version ==="
bun --version
echo "==================="

bun install

# The bind-mounted project may be an arb worktree whose .git file references
# a host path that doesn't exist inside the container. The build script's
# set-version.ts calls git rev-parse, which would fail. Work around this by
# writing the version file directly and compiling without set-version.ts.
if ! git rev-parse HEAD >/dev/null 2>&1; then
  echo "// Generated at build time — do not edit." > src/version.ts
  echo 'export const ARB_VERSION = "dev.docker";' >> src/version.ts
  bun build src/index.ts --compile --outfile dist/arb
else
  bun run build
fi

bun test test/integration/ --concurrent --timeout 60000
