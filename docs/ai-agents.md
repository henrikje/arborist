# Working with AI agents

When using Claude Code or other AI coding agents, start them from the workspace directory rather than an individual worktree. This gives the agent visibility across all repos in the workspace.

If you have [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed, `install.sh` sets up an `arb` [skill](https://docs.anthropic.com/en/docs/claude-code/skills) that teaches Claude how to work with arb. Claude will automatically use the skill when it detects an arb workspace or when you mention arb-related tasks. It knows how to create and remove workspaces, check status, push, pull, rebase, and resolve conflicts — all using the correct flags for non-interactive mode. You can ask things like "create a workspace for the login feature across all repos" or "rebase and push everything" and Claude will handle the multi-repo coordination.

You can also drive Claude across repos using `arb exec`:

```bash
arb exec --dirty claude -p "commit all changes"
arb exec -w operation claude -p "resolve the rebase conflicts and run git rebase --continue"
```
