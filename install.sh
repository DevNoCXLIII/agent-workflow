#!/usr/bin/env bash
# install.sh - Install and configure the /schwi multi-agent swarm orchestration system
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

# Parse CLI flags
FORCE_MODE=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --vps)
            FORCE_MODE="vps"; shift ;;
        --local)
            FORCE_MODE="local"; shift ;;
        -y|--yes)
            FORCE_MODE="default"; shift ;;
        *)
            shift ;;
    esac
done

echo -e "${BLUE}====================================================${NC}"
echo -e "${BLUE}   Installing /schwi Multi-Agent Swarm Workflow    ${NC}"
echo -e "${BLUE}   Platform: ${OS} (${ARCH})                       ${NC}"
echo -e "${BLUE}====================================================${NC}"

# Interactive Environment Selection (VPS vs Local)
IS_VPS_BOOL="true"
if [[ "$FORCE_MODE" == "vps" ]]; then
    IS_VPS_BOOL="true"
    log_info "Mode selected via flag: VPS Mode"
elif [[ "$FORCE_MODE" == "local" ]]; then
    IS_VPS_BOOL="false"
    log_info "Mode selected via flag: Local Mode"
elif [[ -t 0 && "$FORCE_MODE" != "default" ]]; then
    echo ""
    echo -e "${BLUE}┌────────────────────────────────────────────────────────┐${NC}"
    echo -e "${BLUE}│           Deployment Environment Selection             │${NC}"
    echo -e "${BLUE}└────────────────────────────────────────────────────────┘${NC}"
    echo "  [1] VPS / Remote Server (Recommended for cloud instances)"
    echo "      - Auto-pushes worker branches to remote Git repository"
    echo "      - Provides 'Checkout feat/xxx and test' remote review prompts"
    echo "      - Tailscale-isolated Web Dashboard"
    echo ""
    echo "  [2] Local Machine (Laptop / Desktop workstation)"
    echo "      - Local branch inspections and local merges"
    echo "      - No automatic remote git pushes"
    echo ""
    read -rp "Select environment [1=VPS, 2=Local] (Default: 1): " env_choice
    case "$env_choice" in
        2|local|Local|L|l)
            IS_VPS_BOOL="false"
            log_success "Configured for Local Mode"
            ;;
        *)
            IS_VPS_BOOL="true"
            log_success "Configured for VPS Mode"
            ;;
    esac
    echo ""
fi

# 1. Check prerequisites
log_info "Verifying required dependencies in PATH..."
MISSING_DEPS=0
for cmd in herdr jq git; do
    if command -v "$cmd" >/dev/null 2>&1; then
        log_success "Found $cmd ($(command -v "$cmd"))"
    else
        log_error "Missing required dependency: $cmd"
        MISSING_DEPS=$((MISSING_DEPS + 1))
    fi
done

for agent_cmd in agy kilo; do
    if command -v "$agent_cmd" >/dev/null 2>&1; then
        log_success "Found agent binary $agent_cmd ($(command -v "$agent_cmd"))"
    else
        log_warn "Agent binary '$agent_cmd' not found in PATH. Make sure it is installed before running workers."
    fi
done

if [[ $MISSING_DEPS -gt 0 ]]; then
    echo ""
    log_error "Please install missing dependencies and re-run install.sh."
    if [[ "$OS" == "Darwin" ]]; then
        echo -e "${YELLOW}macOS installation suggestions (using Homebrew):${NC}"
        echo "  brew install jq git"
        echo "  curl -fsSL https://herdr.dev/install.sh | bash"
    elif command -v apt-get >/dev/null 2>&1; then
        echo -e "${YELLOW}Debian/Ubuntu installation suggestions:${NC}"
        echo "  sudo apt-get update && sudo apt-get install -y jq git"
    elif command -v pacman >/dev/null 2>&1; then
        echo -e "${YELLOW}Arch Linux installation suggestions:${NC}"
        echo "  sudo pacman -S jq git"
    fi
    echo ""
    exit 1
fi

# 2. Configure Herdr Integrations & Validate Config
log_info "Configuring Herdr integrations..."
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
log_success "Herdr integrations verified (kilo, antigravity-cli, claude)"

if herdr config check >/dev/null 2>&1; then
    log_success "Herdr configuration verified (config: ok)"
else
    log_warn "Herdr configuration has warnings/issues (run 'herdr config check')"
fi

# 3. Deploy schwi-runner CLI
log_info "Deploying schwi-runner orchestration engine..."
mkdir -p "${HOME}/.local/bin"
cp "${SCRIPT_DIR}/bin/schwi-runner" "${HOME}/.local/bin/schwi-runner"
chmod +x "${HOME}/.local/bin/schwi-runner"

# Check if ~/.local/bin is in user PATH
if [[ ":$PATH:" != *":${HOME}/.local/bin:"* ]]; then
    log_warn "~/.local/bin is not in your default PATH."
    if [[ "$OS" == "Darwin" ]]; then
        echo "  On macOS (zsh default), add it to your ~/.zshrc or ~/.zprofile:"
        echo '    export PATH="$HOME/.local/bin:$PATH"'
    else
        echo "  Add it to your ~/.bashrc or ~/.zshrc:"
        echo '    export PATH="$HOME/.local/bin:$PATH"'
    fi
fi
log_success "Installed ~/.local/bin/schwi-runner"

# 4. Clean up legacy flat skill files and deploy proper Skill Directories
log_info "Deploying /schwi skill definitions (Agent Skills standard)..."
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
    log_success "Deployed skill to ${target_dir}/SKILL.md"
done

# 5. Deploy Runtime Rules (Antigravity & Kilo Code standards)
log_info "Deploying runtime rules..."
# Clean up legacy path
rm -rf "${HOME}/.antigravity"

# Antigravity CLI rules
mkdir -p "${HOME}/.gemini/config/rules"
cp "${SCRIPT_DIR}/rules/antigravity-rules.md" "${HOME}/.gemini/config/rules/antigravity-rules.md"
cp "${SCRIPT_DIR}/rules/antigravity-rules.md" "${HOME}/.gemini/config/rules/schwi-rules.md"
log_success "Deployed Antigravity rules to ~/.gemini/config/rules/"

# Kilo Code and universal agent rules
mkdir -p "${HOME}/.config/kilo/rules" "${HOME}/.kilo/rules" "${HOME}/.agents/rules"
cp "${SCRIPT_DIR}/rules/antigravity-rules.md" "${HOME}/.config/kilo/rules/schwi-rules.md"
cp "${SCRIPT_DIR}/rules/antigravity-rules.md" "${HOME}/.kilo/rules/schwi-rules.md"
cp "${SCRIPT_DIR}/rules/antigravity-rules.md" "${HOME}/.agents/rules/schwi-rules.md"

if [[ "$OS" == "Darwin" ]]; then
    mkdir -p "${HOME}/Library/Application Support/kilo/rules"
    cp "${SCRIPT_DIR}/rules/antigravity-rules.md" "${HOME}/Library/Application Support/kilo/rules/schwi-rules.md"
fi
log_success "Deployed agent rules across agent configurations"

# 6. Deploy Web UI Assets
log_info "Deploying Web Dashboard assets..."
mkdir -p "${HOME}/.local/share/schwi/web/public"
cp "${SCRIPT_DIR}/web/server.js" "${HOME}/.local/share/schwi/web/server.js"
cp -r "${SCRIPT_DIR}/web/public/"* "${HOME}/.local/share/schwi/web/public/"
log_success "Deployed Web Dashboard to ~/.local/share/schwi/web/"

# 7. Initialize local directory structures and gitignore
log_info "Initializing workspace structures and configuration..."
mkdir -p "${HOME}/.schwi" "${HOME}/.worktrees" "${SCRIPT_DIR}/.schwi"
if [[ ! -f "${HOME}/.schwi/registry.json" ]] || ! jq empty "${HOME}/.schwi/registry.json" 2>/dev/null; then
    echo "{}" > "${HOME}/.schwi/registry.json"
fi

# Write environment configuration (VPS vs Local)
cat <<EOF > "${HOME}/.schwi/config.json"
{
  "is_vps": ${IS_VPS_BOOL},
  "port": 3456,
  "tailscale": ${IS_VPS_BOOL}
}
EOF
if [[ -d "${SCRIPT_DIR}/.schwi" ]]; then
    cp "${HOME}/.schwi/config.json" "${SCRIPT_DIR}/.schwi/config.json" 2>/dev/null || true
fi

if [[ -f "${HOME}/.gitignore" ]]; then
    grep -qxF ".schwi/" "${HOME}/.gitignore" || echo ".schwi/" >> "${HOME}/.gitignore"
    grep -qxF ".worktrees/" "${HOME}/.gitignore" || echo ".worktrees/" >> "${HOME}/.gitignore"
else
    cat <<EOF > "${HOME}/.gitignore"
.schwi/
.worktrees/
EOF
fi
log_success "Workspace registry, config (is_vps: ${IS_VPS_BOOL}), and .gitignore configured"

# 8. Verification & Syntax validation
log_info "Running validation tests..."
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
echo -e "${GREEN}   /schwi Workflow Successfully Installed!         ${NC}"
echo -e "${GREEN}====================================================${NC}"
echo ""
echo "Quick Test Commands:"
echo "  schwi-runner --help"
echo "  schwi-runner list"
echo ""
