# Antigravity Worker Runtime Rules

- You are operating inside an isolated Git worktree (`.worktrees/*`) managed by Herdr and `/schwi`.
- Read `.schwi-task.md` in the current working directory for task scope and acceptance criteria.
- Perform all file edits, AST refactors, schema adjustments, and migrations strictly within this worktree.
- Run local unit, integration, and typecheck tests before finishing.
- When done and verified, make sure all changed files are saved and exit cleanly or settle into idle state so Herdr transitions your lifecycle state.
