#!/usr/bin/env bash
set -euo pipefail

# setup-stacked.sh — Sets up a three-level stacked branch playground.
#
# Stack structure:
#   main
#    └── feat/auth           (workspace: feat-auth)        frontend, backend, shared
#         └── feat/auth-ui    (workspace: feat-auth-ui)     frontend, backend
#              └── feat/auth-tests (workspace: feat-auth-tests) frontend
#
# Usage: ./setup-stacked.sh [dir]
#   dir defaults to ~/arb-playground/stacked

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_helpers.bash"

require_arb

PLAYGROUND_DIR="${1:-$HOME/arb-playground/stacked}"

header "Setting up stacked branch playground"

# ── Step 1: Create origin repos ──────────────────────────────────

init_playground "$PLAYGROUND_DIR"

step "Creating origin repos with initial content"

create_origin_repo frontend \
    'package.json:{
  "name": "frontend",
  "version": "1.0.0",
  "scripts": {
    "dev": "serve src/",
    "build": "esbuild src/app.js --bundle --outdir=dist",
    "test": "node --test src/**/*.test.js"
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
        <a href="/dashboard">Dashboard</a>
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

# ── Step 3: Level 1 — feat/auth ─────────────────────────────────

step "Creating workspace: feat-auth (frontend, backend, shared)"
arb create feat-auth -b feat/auth frontend backend shared >/dev/null 2>&1

step "Adding auth commits"

# Backend: auth middleware
cat > "$PLAYGROUND_DIR/feat-auth/backend/src/auth.js" <<'JS'
import { getUser } from "./db.js";

const SESSION_TTL = 3600 * 1000; // 1 hour
const sessions = new Map();

export function createSession(userId) {
    const token = crypto.randomUUID();
    sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL });
    return token;
}

export function validateSession(token) {
    const session = sessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
        sessions.delete(token);
        return null;
    }
    return getUser({ headers: { "x-user-id": session.userId } });
}

export function destroySession(token) {
    sessions.delete(token);
}
JS
git -C "$PLAYGROUND_DIR/feat-auth/backend" add -A >/dev/null 2>&1
git "${_git_cfg[@]}" -C "$PLAYGROUND_DIR/feat-auth/backend" commit -m "Add auth middleware with session management" >/dev/null 2>&1

# Shared: auth types
cat > "$PLAYGROUND_DIR/feat-auth/shared/src/auth-types.js" <<'JS'
/**
 * @typedef {{ token: string, expiresAt: number }} Session
 * @typedef {{ userId: string, password: string }} LoginRequest
 * @typedef {{ token: string, user: User }} LoginResponse
 * @typedef {{ message: string }} AuthError
 */
export {};
JS
git -C "$PLAYGROUND_DIR/feat-auth/shared" add -A >/dev/null 2>&1
git "${_git_cfg[@]}" -C "$PLAYGROUND_DIR/feat-auth/shared" commit -m "Add auth type definitions" >/dev/null 2>&1

# Frontend: login page
cat > "$PLAYGROUND_DIR/feat-auth/frontend/src/login.html" <<'HTML'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Login - Acme App</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="login-container">
        <h2>Sign In</h2>
        <form id="login-form">
            <input type="text" name="username" placeholder="Username" required>
            <input type="password" name="password" placeholder="Password" required>
            <button type="submit">Sign In</button>
        </form>
        <p class="error" id="login-error" hidden></p>
    </div>
    <script src="login.js"></script>
</body>
</html>
HTML
git -C "$PLAYGROUND_DIR/feat-auth/frontend" add -A >/dev/null 2>&1
git "${_git_cfg[@]}" -C "$PLAYGROUND_DIR/feat-auth/frontend" commit -m "Add login page" >/dev/null 2>&1

step "Pushing feat-auth"
cd "$PLAYGROUND_DIR/feat-auth"
arb push --yes >/dev/null 2>&1

# ── Step 4: Level 2 — feat/auth-ui ──────────────────────────────

step "Creating workspace: feat-auth-ui (frontend, backend) based on feat/auth"
cd "$PLAYGROUND_DIR"
arb create feat-auth-ui --base feat/auth -b feat/auth-ui frontend backend >/dev/null 2>&1

step "Adding auth UI commits"

# Frontend: login form JS
cat > "$PLAYGROUND_DIR/feat-auth-ui/frontend/src/login.js" <<'JS'
const form = document.getElementById("login-form");
const error = document.getElementById("login-error");

form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.hidden = true;

    const formData = new FormData(form);
    const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: formData.get("username"),
            password: formData.get("password"),
        }),
    });

    if (!res.ok) {
        const data = await res.json();
        error.textContent = data.message;
        error.hidden = false;
        return;
    }

    const { token } = await res.json();
    localStorage.setItem("auth_token", token);
    window.location.href = "/dashboard";
});
JS

# Frontend: login styles
cat >> "$PLAYGROUND_DIR/feat-auth-ui/frontend/src/styles.css" <<'CSS'

/* Login form */
.login-container {
    max-width: 400px;
    margin: 4rem auto;
    padding: 2rem;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
}

.login-container h2 { margin-bottom: 1.5rem; }

.login-container input {
    width: 100%;
    padding: 0.6rem;
    margin-bottom: 1rem;
    border: 1px solid #ccc;
    border-radius: 4px;
}

.login-container button {
    width: 100%;
    padding: 0.7rem;
    background: #0066cc;
    color: #fff;
    border: none;
    border-radius: 4px;
    cursor: pointer;
}

.error { color: #cc0000; margin-top: 1rem; }
CSS

git -C "$PLAYGROUND_DIR/feat-auth-ui/frontend" add -A >/dev/null 2>&1
git "${_git_cfg[@]}" -C "$PLAYGROUND_DIR/feat-auth-ui/frontend" commit -m "Add login form with validation" >/dev/null 2>&1

# Backend: auth routes
cat > "$PLAYGROUND_DIR/feat-auth-ui/backend/src/auth-routes.js" <<'JS'
import { createSession, validateSession, destroySession } from "./auth.js";
import { getUser } from "./db.js";

export function authRouter(req, res) {
    if (req.url === "/api/auth/login" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
            const { username, password } = JSON.parse(body);
            const user = getUser({ headers: { "x-user-id": username } });
            if (!user) {
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ message: "Invalid credentials" }));
                return;
            }
            const token = createSession(username);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ token, user }));
        });
        return true;
    }

    if (req.url === "/api/auth/logout" && req.method === "POST") {
        const token = req.headers.authorization?.replace("Bearer ", "");
        if (token) destroySession(token);
        res.writeHead(204);
        res.end();
        return true;
    }

    return false;
}
JS
git -C "$PLAYGROUND_DIR/feat-auth-ui/backend" add -A >/dev/null 2>&1
git "${_git_cfg[@]}" -C "$PLAYGROUND_DIR/feat-auth-ui/backend" commit -m "Add auth API routes (login/logout)" >/dev/null 2>&1

step "Pushing feat-auth-ui"
cd "$PLAYGROUND_DIR/feat-auth-ui"
arb push --yes >/dev/null 2>&1

# ── Step 5: Level 3 — feat/auth-tests ───────────────────────────

step "Creating workspace: feat-auth-tests (frontend) based on feat/auth-ui"
cd "$PLAYGROUND_DIR"
arb create feat-auth-tests --base feat/auth-ui -b feat/auth-tests frontend >/dev/null 2>&1

step "Adding auth test commits"

cat > "$PLAYGROUND_DIR/feat-auth-tests/frontend/src/login.test.js" <<'JS'
import { describe, it, assert, mock } from "node:test";

describe("Login Form", () => {
    it("submits credentials to /api/auth/login", async () => {
        const fetchMock = mock.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ token: "abc123", user: { name: "Alice" } }),
            })
        );

        // Simulate form submission
        const credentials = { username: "alice", password: "secret" };
        const res = await fetchMock("/api/auth/login", {
            method: "POST",
            body: JSON.stringify(credentials),
        });

        assert.strictEqual(fetchMock.mock.calls.length, 1);
        assert.strictEqual(res.ok, true);
        const data = await res.json();
        assert.strictEqual(data.token, "abc123");
    });

    it("displays error on failed login", async () => {
        const fetchMock = mock.fn(() =>
            Promise.resolve({
                ok: false,
                json: () => Promise.resolve({ message: "Invalid credentials" }),
            })
        );

        const res = await fetchMock("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ username: "bad", password: "wrong" }),
        });

        assert.strictEqual(res.ok, false);
        const data = await res.json();
        assert.strictEqual(data.message, "Invalid credentials");
    });

    it("stores token in localStorage on success", async () => {
        const storage = new Map();
        const mockSetItem = (k, v) => storage.set(k, v);

        // Simulate successful login flow
        const token = "xyz789";
        mockSetItem("auth_token", token);
        assert.strictEqual(storage.get("auth_token"), "xyz789");
    });
});
JS

git -C "$PLAYGROUND_DIR/feat-auth-tests/frontend" add -A >/dev/null 2>&1
git "${_git_cfg[@]}" -C "$PLAYGROUND_DIR/feat-auth-tests/frontend" commit -m "Add login form tests" >/dev/null 2>&1

step "Pushing feat-auth-tests"
cd "$PLAYGROUND_DIR/feat-auth-tests"
arb push --yes >/dev/null 2>&1

# ── Step 6: Simulate team activity on main ───────────────────────

step "Simulating team activity: adding a commit to main on frontend"
add_commits_on_branch frontend team-activity main \
    'src/footer.html:<footer class="site-footer">
    <p>&copy; 2026 Acme Inc. All rights reserved.</p>
    <nav>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
    </nav>
</footer>'

# That created the commit on a "team-activity" branch — now merge it into main
simulate_merge frontend team-activity main merge delete

# ── Step 7: Generate merge-branch.sh helper ──────────────────────

step "Generating merge-branch.sh helper"

cat > "$PLAYGROUND_DIR/merge-branch.sh" <<'HELPER'
#!/usr/bin/env bash
set -euo pipefail

# merge-branch.sh — Simulate a PR merge on the bare remote repos.
# This wraps the bare-repo merge ceremony so you don't need to know raw git.
#
# Usage: ./merge-branch.sh <branch> <target> [squash]
#   branch: the branch to merge (e.g., feat/auth)
#   target: the branch to merge into (e.g., main)
#   squash: pass "squash" for a squash merge (default: merge commit)
#
# Example:
#   ./merge-branch.sh feat/auth main          # merge commit
#   ./merge-branch.sh feat/auth main squash   # squash merge

BRANCH="${1:?Usage: merge-branch.sh <branch> <target> [squash]}"
TARGET="${2:?Usage: merge-branch.sh <branch> <target> [squash]}"
SQUASH="${3:-}"
ORIGINS_DIR="$(cd "$(dirname "$0")/.origins" && pwd)"

_git_cfg=(-c user.name=Demo -c user.email=demo@example.com)

merged_any=false

for bare in "$ORIGINS_DIR"/*.git; do
    repo="$(basename "$bare" .git)"
    tmp="$ORIGINS_DIR/.tmp-merge-${repo}"

    git clone "$bare" "$tmp" >/dev/null 2>&1

    # Check if the branch exists on this remote
    if ! git -C "$tmp" rev-parse "origin/$BRANCH" >/dev/null 2>&1; then
        rm -rf "$tmp"
        continue
    fi

    git -C "$tmp" checkout "$TARGET" >/dev/null 2>&1

    if [[ "$SQUASH" == "squash" ]]; then
        git -C "$tmp" merge --squash "origin/$BRANCH" >/dev/null 2>&1
        git "${_git_cfg[@]}" -C "$tmp" commit -m "Squash merge $BRANCH" >/dev/null 2>&1
        echo "  $repo: squash-merged $BRANCH into $TARGET"
    else
        git "${_git_cfg[@]}" -C "$tmp" merge "origin/$BRANCH" --no-ff -m "Merge $BRANCH" >/dev/null 2>&1
        echo "  $repo: merged $BRANCH into $TARGET"
    fi

    git -C "$tmp" push >/dev/null 2>&1

    # Delete the merged branch on the remote
    git -C "$bare" branch -D "$BRANCH" >/dev/null 2>&1 || true

    rm -rf "$tmp"
    merged_any=true
done

if [[ "$merged_any" == "false" ]]; then
    echo "No repos had branch '$BRANCH'" >&2
    exit 1
fi

echo ""
echo "Done! Now run 'arb fetch' in your workspace to pick up the changes."
HELPER

chmod +x "$PLAYGROUND_DIR/merge-branch.sh"

# ── Done — print instructions ────────────────────────────────────

header "Stacked branch playground ready!"

printf "\n" >&2
hint "Location: $PLAYGROUND_DIR"
printf "\n" >&2

step "Branch stack:"
printf "\n" >&2
hint "  main"
hint "   └── feat/auth           (workspace: feat-auth)        frontend, backend, shared"
hint "        └── feat/auth-ui    (workspace: feat-auth-ui)     frontend, backend"
hint "             └── feat/auth-tests (workspace: feat-auth-tests) frontend"
printf "\n" >&2

step "Current state:"
hint "  - All three workspaces have pushed branches with realistic commits"
hint "  - A team commit landed on main (frontend), so feat-auth is behind"
printf "\n" >&2

step "Try these experiments:"
printf "\n" >&2

hint "  1. Explore the stack:"
hint "     cd $PLAYGROUND_DIR/feat-auth"
hint "     arb status                      # shows ahead + behind for frontend"
hint "     cd ../feat-auth-ui"
hint "     arb status                      # shows base = feat/auth"
printf "\n" >&2

hint "  2. Merge the base and retarget:"
hint "     cd $PLAYGROUND_DIR"
hint "     ./merge-branch.sh feat/auth main"
hint "     cd feat-auth-ui"
hint "     arb fetch && arb status         # base merged into default!"
hint "     arb rebase --retarget --yes     # rebases onto main, clears base"
hint "     arb status                      # now tracks main directly"
printf "\n" >&2

hint "  3. Then collapse the whole stack:"
hint "     cd $PLAYGROUND_DIR"
hint "     ./merge-branch.sh feat/auth-ui main"
hint "     cd feat-auth-tests"
hint "     arb fetch && arb rebase --retarget --yes"
hint "     arb status                      # now tracks main"
printf "\n" >&2

hint "  4. Try squash merge instead:"
hint "     (reset the playground first: re-run this script)"
hint "     cd $PLAYGROUND_DIR"
hint "     ./merge-branch.sh feat/auth main squash"
hint "     cd feat-auth-ui"
hint "     arb fetch && arb rebase --retarget --yes"
printf "\n" >&2
