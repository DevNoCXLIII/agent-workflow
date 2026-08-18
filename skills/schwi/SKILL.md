---
name: schwi
description: >-
  Multi-agent swarm orchestrator combining Kilo Code (Supervisor & Coordinator), Herdr (Process Multiplexer), and Antigravity (High-Complexity Worker Engine). Use when the user invokes /schwi, asks to stage worktrees, spawn workers, manage swarm tasks, or review parallel worker outputs.
---

# `/schwi` Swarm Orchestration Skill

When the user starts a prompt with `/schwi`, switch into the **Schwi Swarm Orchestrator Engine**. You manage multi-phase requirement gathering, git worktree isolation, complexity routing between agent engines, and completion verification queues.

---

## 1. Subcommand: `/schwi create <feature-name>`

Do NOT write code or launch background workers yet. Enter the **3-Phase Discovery Loop**:

1. **Phase 1 (Scope & Intent):** Ask targeted questions about user journeys, endpoints, database schemas, and expected outputs.
2. **Phase 2 (Edge Cases & Blast Radius):** Ask about database migrations, backward compatibility, error states, and affected modules.
3. **Phase 3 (Spec Finalization):** Once requirements are clear, generate a comprehensive specification.

### Action Steps:
1. Generate a slugified worktree name (e.g., `wt-loan-engine`).
2. Run `schwi-runner create-wt --name <wt-name> --branch feat/<feature-name>`.
3. Write the finalized specification into `.worktrees/<wt-name>/.schwi-task.md`.
4. Inform the user:
   > *"Worktree `<wt-name>` staged with spec at `.worktrees/<wt-name>/.schwi-task.md`. Ready for execution via `/schwi work <wt-name>`."*

---

## 2. Subcommand: `/schwi work <wt1, wt2, ...>`

Parse the requested worktree identifiers and execute the following loop:

### Complexity Routing Rule
Inspect the task specification in `.worktrees/<wt-name>/.schwi-task.md`:
- **Route to Kilo (`kilo`):** Localized CRUD operations, single-file scripts, straightforward unit tests, isolated styling/UI components.
- **Route to Antigravity (`agy`):** Multi-table migrations, complex AST transforms, repo-wide graph refactors, cross-module typing, deep architectural overhauls.

### Parallel Execution
For each worktree:
1. Trigger the background worker using `schwi-runner`:
   ```bash
   schwi-runner spawn-worker --wt <wt-name> --agent <agy|kilo> --prompt "Execute the task specified in .schwi-task.md and run local validation tests."
   ```
2. Notify the user which engine was assigned to which worktree and that parallel execution has started.

---

## 3. Serial Verification Queue & Resolution

Because multiple workers may finish concurrently, process completed workers **serially**:

When a worker finishes (`READY_FOR_REVIEW`):
1. Lock the review state for this worktree.
2. Read the worker's output transcript:
   ```bash
   schwi-runner read-output --wt <wt-name> --lines 100
   ```
3. Run verification tests locally in that worktree (`.worktrees/<wt-name>`).
4. Present the review summary directly to the user:

```text
✅ Worktree <wt-name> completed and verified.
Engine: <kilo|agy>
Summary of changes:
<summary of file changes and test results>

Options:
- Reply "Yes" or "Merge" to run integration tests, merge to target branch, and clean up worktree.
- Reply with requested revisions to send feedback to the worker.
```

---

## 4. Direct Feedback Mode (No `/schwi` Prefix)

- **If the user replies with revision requests (without `/schwi`) while a worktree is in review:**
  - Do NOT restart the creation workflow.
  - Forward the prompt directly to that worktree's worker:
    ```bash
    schwi-runner prompt-worker --wt <wt-name> --prompt "<user_revision>"
    ```
  - Wait for the worker to complete and present the updated verification summary.

- **If the user replies "Yes" / "Merge":**
  - Run `schwi-runner cleanup-wt --wt <wt-name> --merge-to staging` (or target branch).
  - Pop the next completed worker from the queue and present its review.
