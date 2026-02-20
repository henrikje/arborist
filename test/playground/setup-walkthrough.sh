#!/usr/bin/env bash
set -euo pipefail

# setup-walkthrough.sh — Recreates the "A quick tour" section from the README.
# Leaves the playground paused at the most interesting moment so you can explore.
#
# Usage: ./setup-walkthrough.sh [dir]
#   dir defaults to ~/arb-playground/walkthrough

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_helpers.bash"

require_arb

PLAYGROUND_DIR="${1:-$HOME/arb-playground/walkthrough}"

header "Setting up walkthrough playground"

# ── Step 1: Create origin repos ──────────────────────────────────

init_playground "$PLAYGROUND_DIR"

step "Creating origin repos with initial content"

create_origin_repo frontend \
    'package.json:{
  "name": "frontend",
  "version": "1.0.0",
  "scripts": {
    "dev": "serve src/",
    "build": "esbuild src/app.js --bundle --outdir=dist"
  }
}' \
    'src/index.html:<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Acme App</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <nav class="navbar">
        <span class="logo">Acme</span>
        <a href="/login">Login</a>
    </nav>
    <main id="app"></main>
    <script src="app.js"></script>
</body>
</html>' \
    'src/app.js:import { greet } from "shared";

const app = document.getElementById("app");

async function init() {
    const res = await fetch("/api/status");
    const data = await res.json();
    app.innerHTML = `<h1>${greet(data.user)}</h1>`;
}

init();' \
    'src/styles.css:* { margin: 0; padding: 0; box-sizing: border-box; }

body { font-family: system-ui, sans-serif; }

.navbar {
    display: flex;
    justify-content: space-between;
    padding: 1rem 2rem;
    background: #fff;
    border-bottom: 1px solid #e0e0e0;
}

.logo { font-weight: 700; font-size: 1.2rem; }

#app { padding: 2rem; }'

create_origin_repo backend \
    'package.json:{
  "name": "backend",
  "version": "1.0.0",
  "scripts": {
    "dev": "node --watch src/server.js",
    "start": "node src/server.js"
  }
}' \
    'src/server.js:import { createServer } from "node:http";
import { router } from "./routes.js";

const server = createServer(router);
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Backend listening on :${PORT}`);
});' \
    'src/routes.js:import { getUser } from "./db.js";

export function router(req, res) {
    if (req.url === "/api/status") {
        const user = getUser(req);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ user: user?.name ?? "guest", ok: true }));
        return;
    }

    res.writeHead(404);
    res.end("Not found");
}' \
    'src/db.js:const users = new Map([
    ["alice", { name: "Alice", role: "admin" }],
    ["bob", { name: "Bob", role: "viewer" }],
]);

export function getUser(req) {
    const id = req.headers["x-user-id"];
    return users.get(id) ?? null;
}'

create_origin_repo shared \
    'package.json:{
  "name": "shared",
  "version": "1.0.0",
  "main": "src/lib.js"
}' \
    'src/lib.js:export function greet(name) {
    return `Welcome back, ${name}!`;
}

export function formatDate(date) {
    return new Intl.DateTimeFormat("en-US").format(date);
}' \
    'src/types.js:/**
 * @typedef {{ name: string, role: "admin" | "viewer" }} User
 * @typedef {{ user: string, ok: boolean }} StatusResponse
 */
export {};'

# ── Step 2: Initialize arb and clone repos ───────────────────────

step "Initializing arb project"
cd "$PLAYGROUND_DIR"
arb init >/dev/null 2>&1

step "Cloning repos"
arb repo clone "$ORIGINS_DIR/frontend.git" >/dev/null 2>&1
arb repo clone "$ORIGINS_DIR/backend.git" >/dev/null 2>&1
arb repo clone "$ORIGINS_DIR/shared.git" >/dev/null 2>&1

# ── Step 3: Start the dark mode feature ──────────────────────────

step "Creating workspace: add-dark-mode (frontend, backend)"
arb create add-dark-mode frontend backend >/dev/null 2>&1

step "Making dark mode changes in frontend"
cd "$PLAYGROUND_DIR/add-dark-mode/frontend"

# Add dark mode CSS
cat >> src/styles.css <<'CSS'

/* Dark mode */
.dark-mode {
    background: #1a1a2e;
    color: #e0e0e0;
}

.dark-mode .navbar {
    background: #16213e;
    border-bottom-color: #0f3460;
}

.dark-toggle {
    cursor: pointer;
    background: none;
    border: 1px solid currentColor;
    color: inherit;
    padding: 0.3rem 0.8rem;
    border-radius: 4px;
}
CSS

# Add toggle button to navbar in index.html
contents=$(<src/index.html)
printf '%s\n' "${contents//'<a href="/login">Login</a>'/'<button class="dark-toggle" onclick="toggleDark()">Dark</button>
        <a href="/login">Login</a>'}" > src/index.html

git add -A >/dev/null 2>&1
git "${_git_cfg[@]}" commit -m "Add dark mode toggle to navbar" >/dev/null 2>&1

# ── Step 4: Handle the interrupt — fix-login-crash ───────────────

step "Creating workspace: fix-login-crash (frontend)"
cd "$PLAYGROUND_DIR"
arb create fix-login-crash frontend >/dev/null 2>&1

step "Making login fix changes in frontend"
cd "$PLAYGROUND_DIR/fix-login-crash/frontend"

# Fix the null pointer in the login flow
cat > src/routes-patch.js <<'JS'
// Patch: guard against missing user object in login flow
export function safeGetUser(req) {
    try {
        const id = req.headers["x-user-id"];
        if (!id) return { name: "guest", role: "viewer" };
        return users.get(id) ?? { name: "guest", role: "viewer" };
    } catch {
        return { name: "guest", role: "viewer" };
    }
}
JS

git add -A >/dev/null 2>&1
git "${_git_cfg[@]}" commit -m "Fix null pointer in login flow" >/dev/null 2>&1

# ── Step 5: Push the hotfix ──────────────────────────────────────

step "Pushing fix-login-crash"
cd "$PLAYGROUND_DIR/fix-login-crash"
arb push --yes >/dev/null 2>&1

# ── Step 6: Simulate the hotfix getting merged on the remote ─────

step "Simulating hotfix merge on remote (merge fix-login-crash into main)"
simulate_merge frontend fix-login-crash main merge delete

# Prune the deleted remote branch in the canonical clone
git -C "$PLAYGROUND_DIR/.arb/repos/frontend" fetch --prune >/dev/null 2>&1

# ── Done — print instructions ────────────────────────────────────

header "Walkthrough playground ready!"

printf "\n" >&2
hint "Location: $PLAYGROUND_DIR"
printf "\n" >&2
step "Current state:"
hint "  - Workspace 'add-dark-mode' has dark mode changes in frontend (unpushed)"
hint "  - Workspace 'fix-login-crash' was pushed, merged on remote, branch deleted"
hint "  - frontend in add-dark-mode is behind main (the hotfix landed)"
printf "\n" >&2

step "Try these commands:"
printf "\n" >&2
hint "  cd $PLAYGROUND_DIR"
hint "  arb list                        # see both workspaces"
hint "  arb remove fix-login-crash      # clean up the merged hotfix"
hint "  cd add-dark-mode"
hint "  arb status                      # frontend is behind main"
hint "  arb rebase --yes                # integrate the hotfix"
hint "  arb status                      # now up to date"
hint "  arb push --yes                  # push the dark mode branch"
printf "\n" >&2
