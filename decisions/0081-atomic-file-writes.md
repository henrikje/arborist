# Atomic File Writes with PID-Unique Temp Paths

Date: 2026-03-16

## Context

Arborist persists cache and config data to several JSON files (`.arb/cache/analysis.json`, `.arb/cache/fetch.json`, `.arb/version.json`, `.arbws/config.json`, `.arbws/templates.json`). Two concurrent `arb` invocations can corrupt these files. Cache files used a write-to-temp-then-rename pattern, but the temp path was deterministic (`${filePath}.tmp`) — shared across all processes. Config and manifest files used bare `writeFileSync` with no atomicity at all.

## Options

### PID-unique temp paths in the same directory

Write to `${filePath}.tmp.${process.pid}`, then `renameSync` into place. Each concurrent process gets its own temp file. A shared `atomicWriteFileSync` utility centralizes the pattern.

- **Pros:** Simple, no external dependencies, rename is atomic on POSIX when source and destination share a filesystem, PID is guaranteed unique among concurrent processes.
- **Cons:** Stale temp files left behind if a process is killed between write and rename (benign — they are never read and get overwritten on PID reuse).

### Temp files in `/tmp` or `os.tmpdir()`

Write the temp file to the system temp directory, then rename into place.

- **Pros:** Temp files are outside the project directory.
- **Cons:** `renameSync` fails with `EXDEV` (cross-device link) when source and destination are on different filesystems, which is common (e.g. project on Dropbox, `/tmp` on local disk). Would require falling back to copy-then-delete, losing atomicity.

### File locking (advisory locks, lockfiles)

Use `flock`, lockfiles, or similar mechanisms to serialize access.

- **Pros:** Solves both the temp file collision and the read-modify-write TOCTOU.
- **Cons:** Significant complexity (lock timeouts, stale lock cleanup, cross-platform differences). Overkill for cache files where data loss is acceptable.

## Decision

PID-unique temp paths in the same directory, implemented as a shared `atomicWriteFileSync` utility in `src/lib/core/fs.ts`. Applied to all persistent file writes (caches, configs, manifests).

## Reasoning

The PID-unique approach is the simplest fix that eliminates the concrete bug (two processes clobbering each other's temp file). It keeps the existing atomic-rename guarantee, adds it to files that lacked it, and requires no external dependencies or platform-specific code. The `/tmp` approach was rejected because same-filesystem is a hard requirement for `renameSync`. File locking was rejected as disproportionate — cache data loss from the remaining read-modify-write TOCTOU is acceptable.

## Consequences

- All persistent file writes now go through `atomicWriteFileSync`. New code that persists arb state should use it too.
- The read-modify-write TOCTOU on caches remains: two processes can load the same cache, add different entries, and the last writer's snapshot wins. This is acceptable for cache data. If it ever becomes a problem for config files, file locking would be the next step.
- Killed processes may leave `.tmp.${pid}` files in `.arb/cache/` or `.arbws/`. These are harmless and overwritten on PID reuse.
