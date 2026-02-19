# Tips

## Browsing the default branch

To view the latest default-branch code across all repos:

```bash
arb create main --all-repos  # assuming main is the default branch
```

_Note_: Creating a workspace for the default branch works because Arborist keeps the canonical clones in detached HEAD state.

## Multiple arb roots

Each arb root is independent. Commands find the right one by walking up from the current directory looking for the `.arb/` marker. Feel free to create multiple roots for different projects:

```bash
cd ~/project-a && arb init
cd ~/project-b && arb init
```
