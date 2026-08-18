# `/schwi` Multi-Agent Swarm Orchestration Workflow

A multi-agent swarm orchestration framework combining **Kilo Code** (Supervisor & Coordinator), **Herdr** (Process Multiplexer & Agent Lifecycle Manager), and **Antigravity / agy** (High-Complexity Worker Engine).

Supports both **macOS** (Apple Silicon & Intel) and **Linux**.

---

## Directory Structure

```text
~/agent-workflow/
├── bin/
│   └── schwi-runner          # Headless orchestration CLI runner & web server gateway
├── web/
│   ├── server.js             # Zero-dependency Node.js HTTP/SSE server (Tailscale-isolated)
│   └── public/
│       └── index.html        # Lightweight Single-Page Web Dashboard (<40KB)
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
- **Node.js (Optional for Web Dashboard):**
  - Standard Node.js runtime (no npm dependencies required).

### Installation
Run the installer to deploy `schwi-runner`, skill directories (`skills/schwi/SKILL.md`), runtime rules, web dashboard assets, and Herdr integrations:

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

## Web UI Dashboard (Bypass SSH Latency)

Start the ultra-lightweight Web Dashboard to monitor worktrees, view live agent terminal transcripts, edit task specifications, and trigger 1-click merges with **zero keystroke latency**:

```bash
schwi-runner serve --tailscale --port 3456
```

### Tailscale Access Control & Security
- The web server automatically detects and binds to your private **Tailscale IP** (`100.x.y.z`) or `127.0.0.1`.
- Built-in application-level IP filtering blocks any unauthorized traffic outside the Tailscale CGNAT subnet (`100.64.0.0/10`) and localhost.
- Access the web interface from your local laptop or phone:
  `http://<tailscale-vps-ip>:3456`

---

## VPS Git Workflow (Local Testing from Remote VPS)

When running on a VPS (`is_vps: true` in `.schwi/config.json` or `SCHWI_IS_VPS=true`):

1. **Automatic Remote Push:** Once a worker finishes task execution in an isolated worktree (`.worktrees/<wt-name>`), `schwi-runner` auto-commits the changes and pushes the branch to `origin <branch-name>`.
2. **Review Notification:** The runner and Web UI prompt:
   > 🚀 **Checkout `feat/xxx` and test, tell me to integrate now or reply with your revision**
   > `git fetch origin && git checkout feat/xxx`
3. **Local Testing:** You pull and test the branch locally on your machine.
4. **Integration:** Reply `integrate now` (or click **"🚀 Integrate Now"** in the Web UI) to merge into `main`, push to upstream, and clean up the worktree.

To toggle VPS mode:
```bash
schwi-runner config --vps true   # Enable VPS remote push workflow
schwi-runner config --vps false  # Switch to local worktree mode
```

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

### 2. Runtime Rules Discovery
- **Antigravity:** `~/.gemini/config/rules/*.md`, `GEMINI.md`, `AGENTS.md`
- **Kilo Code:** `~/.config/kilo/rules/*.md`, `~/Library/Application Support/kilo/rules/*.md` (macOS), `AGENTS.md`
- **Isolated Worktrees:** Auto-seeded with `AGENTS.md` upon creation.

### 3. `schwi-runner` CLI
The headless runner executes worktree management, agent operations, and web serving:

- `schwi-runner create-wt --name <wt-name> --branch <branch-name> [--spec <spec>]`
- `schwi-runner spawn-worker --wt <wt-name> --agent <agy|kilo> --prompt <prompt>`
- `schwi-runner prompt-worker --wt <wt-name> --prompt <prompt>`
- `schwi-runner read-output --wt <wt-name> [--lines <n>]`
- `schwi-runner cleanup-wt --wt <wt-name> [--merge-to <branch>]`
- `schwi-runner list`
- `schwi-runner status --wt <wt-name>`
- `schwi-runner serve [--port <port>] [--host <host>] [--tailscale]`
- `schwi-runner config [--vps <true|false>] [--port <port>]`

### 4. `/schwi` Chat Workflow
In your AI chat (Kilo / Claude / Antigravity):
- `/schwi create <feature>` : Triggers the 3-phase discovery loop and stages `.schwi-task.md`.
- `/schwi work <wt1, wt2>` : Routes tasks according to complexity (`kilo` vs. `agy`) and executes in parallel.
- Direct feedback loop : Review results, iterate with prompt revisions, or merge to target branch.
