#!/usr/bin/env bash
# update.sh - Update and sync the /schwi multi-agent swarm orchestration system
# Cross-platform support for macOS (Apple Silicon & Intel) and Linux
# Fully compliant with Kilo Code, Claude Code, and Antigravity CLI standards

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

OS="$(uname -s)"
ARCH="$(uname -m)"

# On macOS, include Homebrew bin paths in current PATH if present
if [[ "$OS" == "Darwin" ]]; then
    if [[ -d "/opt/homebrew/bin" && ":$PATH:" != *":/opt/homebrew/bin:"* ]]; then
        export PATH="/opt/homebrew/bin:$PATH"
    fi
    if [[ -d "/usr/local/bin" && ":$PATH:" != *":/usr/local/bin:"* ]]; then
        export PATH="/usr/local/bin:$PATH"
    fi
fi

if [[ -d "${HOME}/.local/bin" && ":$PATH:" != *":${HOME}/.local/bin:"* ]]; then
    export PATH="${HOME}/.local/bin:$PATH"
fi

log_info() {
    echo -e "${BLUE}==>${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}Warning:${NC} $1"
}

log_error() {
    echo -e "${RED}Error:${NC} $1" >&2
}

echo -e "${BLUE}====================================================${NC}"
echo -e "${BLUE}    Updating /schwi Multi-Agent Swarm Workflow      ${NC}"
echo -e "${BLUE}    Platform: ${OS} (${ARCH})                       ${NC}"
echo -e "${BLUE}====================================================${NC}"

# 1. Pull latest changes if git repository with tracking upstream
if git -C "$SCRIPT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if git -C "$SCRIPT_DIR" rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
        log_info "Pulling latest updates from git repository..."
        git -C "$SCRIPT_DIR" pull --ff-only || log_warn "Git pull failed or has local changes, proceeding with local update."
    fi
fi

# 2. Sync schwi-runner executable
log_info "Updating ~/.local/bin/schwi-runner..."
mkdir -p "${HOME}/.local/bin"
cp "${SCRIPT_DIR}/bin/schwi-runner" "${HOME}/.local/bin/schwi-runner"
chmod +x "${HOME}/.local/bin/schwi-runner"
log_success "Updated ~/.local/bin/schwi-runner"

# 3. Clean up legacy flat skill files and sync proper Skill Directories
log_info "Updating /schwi skill definitions (Agent Skills standard)..."
rm -f "${HOME}/.kilo/skills/schwi.md" "${HOME}/.claude/skills/schwi.md" "${HOME}/.config/kilo/skills/schwi.md"

SKILL_TARGET_DIRS=(
    "${HOME}/.config/kilo/skills/schwi"
    "${HOME}/.kilo/skills/schwi"
    "${HOME}/.claude/skills/schwi"
    "${HOME}/.gemini/config/skills/schwi"
    "${HOME}/.agents/skills/schwi"
)

if [[ "$OS" == "Darwin" ]]; then
    SKILL_TARGET_DIRS+=("${HOME}/Library/Application Support/kilo/skills/schwi")
fi

for target_dir in "${SKILL_TARGET_DIRS[@]}"; do
    mkdir -p "$target_dir"
    cp "${SCRIPT_DIR}/skills/schwi/SKILL.md" "${target_dir}/SKILL.md"
    log_success "Updated skill at ${target_dir}/SKILL.md"
done

# 4. Sync Runtime Rules (Antigravity & Kilo Code standards)
log_info "Updating runtime rules..."
# Clean up legacy path
rm -rf "${HOME}/.antigravity"

# Antigravity CLI rules
mkdir -p "${HOME}/.gemini/config/rules"
cp "${SCRIPT_DIR}/rules/antigravity-rules.md" "${HOME}/.gemini/config/rules/antigravity-rules.md"
cp "${SCRIPT_DIR}/rules/antigravity-rules.md" "${HOME}/.gemini/config/rules/schwi-rules.md"
log_success "Updated Antigravity rules at ~/.gemini/config/rules/"

# Kilo Code and universal agent rules
mkdir -p "${HOME}/.config/kilo/rules" "${HOME}/.kilo/rules" "${HOME}/.agents/rules"
cp "${SCRIPT_DIR}/rules/antigravity-rules.md" "${HOME}/.config/kilo/rules/schwi-rules.md"
cp "${SCRIPT_DIR}/rules/antigravity-rules.md" "${HOME}/.kilo/rules/schwi-rules.md"
cp "${SCRIPT_DIR}/rules/antigravity-rules.md" "${HOME}/.agents/rules/schwi-rules.md"

if [[ "$OS" == "Darwin" ]]; then
    mkdir -p "${HOME}/Library/Application Support/kilo/rules"
    cp "${SCRIPT_DIR}/rules/antigravity-rules.md" "${HOME}/Library/Application Support/kilo/rules/schwi-rules.md"
fi
log_success "Updated agent rules across agent configurations"

# 5. Refresh Herdr Integrations & Validate Config
log_info "Refreshing Herdr integrations..."
herdr integration install kilo 2>/dev/null || true
herdr integration install antigravity-cli 2>/dev/null || true
herdr integration install claude 2>/dev/null || true

# Guard Kilo Herdr integration against Bun node:net double-free segfault
KILO_PLUGIN="${HOME}/.config/kilo/plugin/herdr-agent-state.js"
if [[ -f "$KILO_PLUGIN" ]]; then
    node -e "
    const fs = require('fs');
    const p = '${KILO_PLUGIN}';
    let code = fs.readFileSync(p, 'utf8');
    if (!code.includes('let done = false;')) {
        code = code.replace(/return new Promise\(\(resolve\) => \{[\s\S]*?client\.on\(\"close\", resolve\);[\s\S]*?\}\);/,
\`return new Promise((resolve) => {
    let done = false;
    let client;
    const finish = () => {
      if (done) return;
      done = true;
      try { if (client) client.destroy(); } catch (e) {}
      resolve();
    };
    try {
      client = net.createConnection(socketEndpoint, () => {
        try { client.write(\\\`\\\${JSON.stringify(request)}\\\\n\\\`); } catch (e) { finish(); }
      });
      client.setTimeout(500, finish);
      client.on(\"data\", finish);
      client.on(\"error\", finish);
      client.on(\"end\", finish);
      client.on(\"close\", finish);
    } catch (e) { resolve(); }
  });\`);
        fs.writeFileSync(p, code, 'utf8');
    }
    " 2>/dev/null || true
fi
log_success "Herdr integrations refreshed"

if herdr config check >/dev/null 2>&1; then
    log_success "Herdr configuration verified (config: ok)"
else
    log_warn "Herdr configuration has warnings/issues (run 'herdr config check')"
fi

# 6. Sync Web Dashboard Assets
log_info "Syncing Web Dashboard assets..."
mkdir -p "${HOME}/.local/share/schwi/web/public" "${HOME}/.schwi"
cp "${SCRIPT_DIR}/web/server.js" "${HOME}/.local/share/schwi/web/server.js"
cp -r "${SCRIPT_DIR}/web/public/"* "${HOME}/.local/share/schwi/web/public/"
log_success "Synced Web Dashboard at ~/.local/share/schwi/web/"

# Ensure default ~/.schwi/config.json exists
if [[ ! -f "${HOME}/.schwi/config.json" ]] || ! jq empty "${HOME}/.schwi/config.json" 2>/dev/null; then
    echo '{"is_vps": false, "port": 3456}' > "${HOME}/.schwi/config.json"
fi

# 7. Syntax Check
log_info "Validating syntax..."
bash -n "${HOME}/.local/bin/schwi-runner"
bash -n "${SCRIPT_DIR}/install.sh"
bash -n "${SCRIPT_DIR}/update.sh"
if command -v node >/dev/null 2>&1; then
    node --check "${SCRIPT_DIR}/web/server.js"
    log_success "Node.js Web Server validated"
fi
log_success "All scripts validated successfully"

echo ""
echo -e "${GREEN}====================================================${NC}"
echo -e "${GREEN}    /schwi Workflow Successfully Updated!          ${NC}"
echo -e "${GREEN}====================================================${NC}"
echo ""
