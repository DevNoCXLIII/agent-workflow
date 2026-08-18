# `/schwi` Multi-Agent Swarm Orchestration Workflow

A multi-agent swarm orchestration framework combining **Kilo Code** (Supervisor & Coordinator), **Herdr** (Process Multiplexer & Agent Lifecycle Manager), and **Antigravity / agy** (High-Complexity Worker Engine).

Supports both **macOS** (Apple Silicon & Intel) and **Linux**.

---

## Directory Structure

```text
~/agent-workflow/
├── bin/
│   └── schwi-runner          # Headless orchestration CLI runner
├── skills/
│   └── schwi/
│       └── SKILL.md          # /schwi Agent Skill definition (Kilo / Claude / Antigravity standard)
├── rules/
│   └── antigravity-rules.md  # Worker runtime execution rules
├── install.sh                # Initial installation & environment setup script (cross-platform)
├── update.sh                 # Sync & update script (cross-platform)
└── README.md                 # Documentation
```

---

## Quick Start

### Prerequisites

- **Git & jq:**
  - **macOS:** `brew install jq git`
  - **Linux:** `sudo apt-get install jq git` / `sudo pacman -S jq git`
- **Herdr:**
  - `curl -fsSL https://herdr.dev/install.sh | bash`
- **Agents:**
  - `kilo` (Kilo Code CLI)
  - `agy` (Antigravity CLI)

### Installation
Run the installer to deploy `schwi-runner`, skill directories (`skills/schwi/SKILL.md`), runtime rules, and Herdr integrations:

```bash
cd ~/agent-workflow
./install.sh
```

### Updating
Whenever you make modifications inside `~/agent-workflow`, apply them by running:

```bash
cd ~/agent-workflow
./update.sh
```

---

## Platform & Shell Support

- **macOS (Darwin):**
  - Automatic detection for Apple Silicon (`/opt/homebrew/bin`) and Intel (`/usr/local/bin`) Homebrew paths.
  - Deploys skills and rules across `~/.config/kilo`, `~/Library/Application Support/kilo`, `~/.claude`, `~/.gemini`, and `~/.agents`.
  - Configures for default macOS shell (`zsh` with `~/.zshrc` / `~/.zprofile`) and `bash`.
- **Linux:**
  - Deploys to XDG standards (`~/.config/kilo`, `~/.claude`, `~/.gemini/config`, `~/.agents`).
  - Supports `bash` (`~/.bashrc`) and `zsh`.

---

## Architecture & Standards

### 1. Agent Skills Standard
Skills are organized in directory packages compliant with Kilo Code, Claude Code, and Antigravity CLI:
- **Locations:**
  - `~/.config/kilo/skills/schwi/SKILL.md`
  - `~/Library/Application Support/kilo/skills/schwi/SKILL.md` (macOS)
  - `~/.claude/skills/schwi/SKILL.md`
  - `~/.gemini/config/skills/schwi/SKILL.md`
  - `~/.agents/skills/schwi/SKILL.md`
- **Metadata:** Frontmatter with `name` and `description` enabling progressive disclosure.

### 2. Runtime Rules Discovery
- **Antigravity:** `~/.gemini/config/rules/*.md`, `GEMINI.md`, `AGENTS.md`
- **Kilo Code:** `~/.config/kilo/rules/*.md`, `~/Library/Application Support/kilo/rules/*.md` (macOS), `AGENTS.md`
- **Isolated Worktrees:** Auto-seeded with `AGENTS.md` upon creation.

### 3. `schwi-runner` CLI
The headless runner executes worktree management and agent operations:

- `schwi-runner create-wt --name <wt-name> --branch <branch-name> [--spec <spec>]`
- `schwi-runner spawn-worker --wt <wt-name> --agent <agy|kilo> --prompt <prompt>`
- `schwi-runner prompt-worker --wt <wt-name> --prompt <prompt>`
- `schwi-runner read-output --wt <wt-name> [--lines <n>]`
- `schwi-runner cleanup-wt --wt <wt-name> [--merge-to <branch>]`
- `schwi-runner list`
- `schwi-runner status --wt <wt-name>`

### 4. `/schwi` Chat Workflow
In your AI chat (Kilo / Claude / Antigravity):
- `/schwi create <feature>` : Triggers the 3-phase discovery loop and stages `.schwi-task.md`.
- `/schwi work <wt1, wt2>` : Routes tasks according to complexity (`kilo` vs. `agy`) and executes in parallel.
- Direct feedback loop : Review results, iterate with prompt revisions, or merge to target branch.
