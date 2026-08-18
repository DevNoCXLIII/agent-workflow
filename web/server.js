const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec, execSync } = require('child_process');
const { EventEmitter } = require('events');

const PORT = parseInt(process.env.SCHWI_PORT || process.env.PORT || '3456', 10);
const EVENT_BUS = new EventEmitter();

function getRepoRoot() {
  try {
    return execSync('git rev-parse --show-toplevel 2>/dev/null', { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

const REPO_ROOT = getRepoRoot();
const SCHWI_DIR = path.join(REPO_ROOT, '.schwi');
const WORKTREES_DIR = path.join(REPO_ROOT, '.worktrees');
const REGISTRY_FILE = path.join(SCHWI_DIR, 'registry.json');
const CONFIG_FILE = path.join(SCHWI_DIR, 'config.json');
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')
  : path.join(process.env.HOME || '', '.local', 'share', 'schwi', 'web', 'public');

const GLOBAL_CONFIG_FILE = path.join(process.env.HOME || '', '.schwi', 'config.json');

function initDirs() {
  if (!fs.existsSync(SCHWI_DIR)) fs.mkdirSync(SCHWI_DIR, { recursive: true });
  if (!fs.existsSync(WORKTREES_DIR)) fs.mkdirSync(WORKTREES_DIR, { recursive: true });
  if (!fs.existsSync(REGISTRY_FILE)) fs.writeFileSync(REGISTRY_FILE, '{}', 'utf8');
  if (!fs.existsSync(CONFIG_FILE)) {
    if (fs.existsSync(GLOBAL_CONFIG_FILE)) {
      try {
        fs.copyFileSync(GLOBAL_CONFIG_FILE, CONFIG_FILE);
      } catch {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify({ is_vps: false, port: PORT }, null, 2), 'utf8');
      }
    } else {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify({ is_vps: false, port: PORT }, null, 2), 'utf8');
    }
  }
}

initDirs();

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
    if (fs.existsSync(GLOBAL_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(GLOBAL_CONFIG_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading config:', e.message);
  }
  return { is_vps: false, port: PORT };
}

function writeConfig(patch) {
  const curr = readConfig();
  const next = { ...curr, ...patch };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function isVpsMode() {
  if (process.env.SCHWI_IS_VPS === '1' || process.env.SCHWI_IS_VPS === 'true' || process.env.SCHWI_ENV === 'vps') {
    return true;
  }
  if (process.env.SCHWI_IS_VPS === '0' || process.env.SCHWI_IS_VPS === 'false' || process.env.SCHWI_ENV === 'local') {
    return false;
  }
  const cfg = readConfig();
  return cfg.is_vps === true;
}

function getTailscaleIp() {
  try {
    const out = execSync('tailscale ip -4 2>/dev/null', { encoding: 'utf8' }).trim();
    if (out) return out.split('\n')[0].trim();
  } catch {}
  return null;
}

function readRegistry() {
  try {
    if (fs.existsSync(REGISTRY_FILE)) {
      return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading registry:', e.message);
  }
  return {};
}

// IP Filtering Middleware (Restricts access exclusively to Tailscale CGNAT range 100.64.0.0/10 and Localhost)
function isIpAllowed(remoteIp) {
  if (!remoteIp) return false;
  const ip = remoteIp.replace(/^::ffff:/, '');

  // Local loopback
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
    return true;
  }

  // Tailscale IPv4 CGNAT range: 100.64.0.0 to 100.127.255.255
  if (ip.startsWith('100.')) {
    const parts = ip.split('.').map(Number);
    if (parts.length === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) {
      return true;
    }
  }

  // Tailscale IPv6 ULA range: fd7a:115c:a1e0::/48
  if (ip.toLowerCase().startsWith('fd7a:115c:a1e0:')) {
    return true;
  }

  return false;
}

function getSchwiRunnerBin() {
  if (process.env.SCHWI_RUNNER_BIN && fs.existsSync(process.env.SCHWI_RUNNER_BIN)) {
    return process.env.SCHWI_RUNNER_BIN;
  }
  const homeBin = path.join(process.env.HOME || '', '.local', 'bin', 'schwi-runner');
  if (fs.existsSync(homeBin)) return homeBin;

  const repoBin = path.join(REPO_ROOT, 'bin', 'schwi-runner');
  if (fs.existsSync(repoBin)) return repoBin;

  const parentBin = path.join(__dirname, '..', 'bin', 'schwi-runner');
  if (fs.existsSync(parentBin)) return parentBin;

  return 'schwi-runner';
}

// Subprocess runner helper
function runSchwiRunner(args) {
  return new Promise((resolve, reject) => {
    const binPath = getSchwiRunnerBin();
    const proc = spawn(binPath, args, { cwd: REPO_ROOT, env: { ...process.env } });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => {
      stdout += d.toString();
      EVENT_BUS.emit('log', { timestamp: new Date().toISOString(), text: d.toString() });
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      EVENT_BUS.emit('log', { timestamp: new Date().toISOString(), text: d.toString(), isErr: true });
    });

    proc.on('error', (err) => {
      console.error(`[Process Error] Failed to spawn ${binPath}:`, err.message);
      reject(new Error(`Failed to execute '${binPath}': ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr });
      } else {
        reject(new Error(`Command failed with exit code ${code}\n${stderr || stdout}`));
      }
    });
  });
}

// File watcher to emit registry changes over SSE
let prevRegistryContent = '';
fs.watchFile(REGISTRY_FILE, { interval: 1000 }, () => {
  try {
    const content = fs.readFileSync(REGISTRY_FILE, 'utf8');
    if (content !== prevRegistryContent) {
      prevRegistryContent = content;
      EVENT_BUS.emit('registry_update', readRegistry());
    }
  } catch {}
});

const server = http.createServer(async (req, res) => {
  const remoteIp = req.socket.remoteAddress;

  // Security check: Only allow Tailscale or Localhost
  if (!isIpAllowed(remoteIp)) {
    console.warn(`[SECURITY BLOCK] Rejected connection from unauthorized IP: ${remoteIp}`);
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden: Access restricted to Tailscale mesh network and localhost only.\n');
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS headers for private network
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Parse JSON Body
  let body = {};
  if (method === 'POST') {
    try {
      const buffers = [];
      for await (const chunk of req) buffers.push(chunk);
      const raw = Buffer.concat(buffers).toString('utf8');
      if (raw) body = JSON.parse(raw);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }
  }

  // SSE Events Endpoint
  if (pathname === '/api/events' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(`data: ${JSON.stringify({ type: 'init', registry: readRegistry(), is_vps: isVpsMode() })}\n\n`);

    const onReg = (reg) => res.write(`data: ${JSON.stringify({ type: 'registry', data: reg, is_vps: isVpsMode() })}\n\n`);
    const onLog = (log) => res.write(`data: ${JSON.stringify({ type: 'log', data: log })}\n\n`);

    EVENT_BUS.on('registry_update', onReg);
    EVENT_BUS.on('log', onLog);

    const pingTimer = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(pingTimer);
      EVENT_BUS.off('registry_update', onReg);
      EVENT_BUS.off('log', onLog);
    });
    return;
  }

  // API: Status
  if (pathname === '/api/status' && method === 'GET') {
    const tailscaleIp = getTailscaleIp();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      is_vps: isVpsMode(),
      tailscale_ip: tailscaleIp,
      repo_root: REPO_ROOT,
      registry: readRegistry(),
      config: readConfig(),
    }));
    return;
  }

  // API: Config update
  if (pathname === '/api/config' && method === 'POST') {
    const updated = writeConfig(body);
    EVENT_BUS.emit('registry_update', readRegistry());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, config: updated, is_vps: isVpsMode() }));
    return;
  }

function analyzeTaskPrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Prompt is required');
  }

  const raw = prompt.trim();
  // Extract words for slug
  const cleanWords = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => !['a', 'an', 'the', 'to', 'for', 'in', 'on', 'with', 'and', 'or', 'of', 'please', 'i', 'want', 'make', 'add', 'create', 'let', 'us'].includes(w) && w.length > 1);

  const slug = cleanWords.slice(0, 4).join('-') || 'feature-task';
  const wtName = `wt-${slug}`;
  const branchName = `feat/${slug}`;

  // Complexity evaluation
  const heavyKeywords = [
    'migrate', 'migration', 'refactor', 'architecture', 'database', 'schema',
    'orm', 'prisma', 'docker', 'cross-module', 'ast', 'rewrite', 'multi-file',
    'backend', 'api', 'auth', 'oauth', 'jwt', 'security', 'fullstack', 'service'
  ];

  const lowerRaw = raw.toLowerCase();
  const matchedHeavy = heavyKeywords.filter((k) => lowerRaw.includes(k));
  const isHeavy = matchedHeavy.length > 0;

  const agent = isHeavy ? 'agy' : 'kilo';
  const complexity = isHeavy ? 'High Complexity' : 'Localized / Fast';
  const reason = isHeavy
    ? `Task touches system-level aspects (${matchedHeavy.join(', ')}). Routed to Antigravity.`
    : 'Task is focused or component-level. Routed to Kilo for rapid turnaround.';

  const nowIso = new Date().toISOString();
  const sentences = raw.split(/[.\n;]+/).map((s) => s.trim()).filter((s) => s.length > 3);

  const objectives = sentences.length > 0
    ? sentences.map((s) => `- ${s[0].toUpperCase() + s.slice(1)}`).join('\n')
    : `- Implement requirements for ${raw}`;

  const spec = `# Task: ${wtName}

**Branch:** \`${branchName}\`
**Created:** ${nowIso}
**Complexity:** ${complexity} (\`${agent}\`)

## 1. Objectives & Scope
${objectives}

## 2. Edge Cases & Blast Radius
- Verify backward compatibility with existing modules and endpoints.
- Ensure error states, null checks, and invalid inputs are handled cleanly.
- Check environment variable requirements and configuration defaults.

## 3. Acceptance Criteria
- [ ] Core feature implementation complete and verified
- [ ] Local tests, typechecks, or linters passing
- [ ] No regression in existing functionality
- [ ] Clean exit for Herdr lifecycle transition
`;

  return {
    name: wtName,
    branch: branchName,
    agent,
    complexity,
    reason,
    spec,
    summary: raw.length > 90 ? raw.slice(0, 87) + '...' : raw,
  };
}

// API: Requirement Analysis
if (pathname === '/api/analyze-task' && method === 'POST') {
  const { prompt } = body;
  if (!prompt || !prompt.trim()) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Prompt is required for requirement analysis' }));
    return;
  }
  try {
    const analysis = analyzeTaskPrompt(prompt);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, analysis }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
  return;
}

  // API: Worktree Create
  if (pathname === '/api/worktrees/create' && method === 'POST') {
    const { name, branch, spec } = body;
    if (!name || !branch) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'name and branch are required' }));
      return;
    }
    try {
      const args = ['create-wt', '--name', name, '--branch', branch];
      if (spec) args.push('--spec', spec);
      const out = await runSchwiRunner(args);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, output: out.stdout, registry: readRegistry() }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API: Get Task Spec
  const specMatch = pathname.match(/^\/api\/worktrees\/([^/]+)\/spec$/);
  if (specMatch && method === 'GET') {
    const wtName = specMatch[1];
    const specPath = path.join(WORKTREES_DIR, wtName, '.schwi-task.md');
    let content = '';
    if (fs.existsSync(specPath)) {
      content = fs.readFileSync(specPath, 'utf8');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ wt: wtName, spec: content }));
    return;
  }

  // API: Save Task Spec
  if (specMatch && method === 'POST') {
    const wtName = specMatch[1];
    const { spec } = body;
    const specPath = path.join(WORKTREES_DIR, wtName, '.schwi-task.md');
    try {
      fs.writeFileSync(specPath, spec || '', 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // API: Get Diff
  const diffMatch = pathname.match(/^\/api\/worktrees\/([^/]+)\/diff$/);
  if (diffMatch && method === 'GET') {
    const wtName = diffMatch[1];
    const wtPath = path.join(WORKTREES_DIR, wtName);
    try {
      let diff = '';
      if (fs.existsSync(wtPath)) {
        diff = execSync('git diff HEAD~1..HEAD 2>/dev/null || git diff 2>/dev/null || true', {
          cwd: wtPath,
          encoding: 'utf8',
        });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ wt: wtName, diff }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ wt: wtName, diff: 'No diff available' }));
    }
    return;
  }

  // API: Get Output Transcript
  const outMatch = pathname.match(/^\/api\/worktrees\/([^/]+)\/output$/);
  if (outMatch && method === 'GET') {
    const wtName = outMatch[1];
    try {
      const out = await runSchwiRunner(['read-output', '--wt', wtName, '--lines', '150']);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ wt: wtName, output: out.stdout }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ wt: wtName, output: e.message }));
    }
    return;
  }

  // API: Spawn Worker
  const spawnMatch = pathname.match(/^\/api\/worktrees\/([^/]+)\/spawn$/);
  if (spawnMatch && method === 'POST') {
    const wtName = spawnMatch[1];
    const { agent = 'kilo', prompt = 'Execute task in .schwi-task.md' } = body;
    // Execute in background
    runSchwiRunner(['spawn-worker', '--wt', wtName, '--agent', agent, '--prompt', prompt])
      .catch((err) => console.error(`Worker spawn error on ${wtName}:`, err.message));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: `Spawned ${agent} worker for ${wtName}` }));
    return;
  }

  // API: Prompt Worker
  const promptMatch = pathname.match(/^\/api\/worktrees\/([^/]+)\/prompt$/);
  if (promptMatch && method === 'POST') {
    const wtName = promptMatch[1];
    const { prompt } = body;
    if (!prompt) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Prompt is required' }));
      return;
    }
    runSchwiRunner(['prompt-worker', '--wt', wtName, '--prompt', prompt])
      .catch((err) => console.error(`Worker prompt error on ${wtName}:`, err.message));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: `Forwarded prompt to ${wtName}` }));
    return;
  }

  // API: Integrate / Cleanup
  const integrateMatch = pathname.match(/^\/api\/worktrees\/([^/]+)\/integrate$/);
  if (integrateMatch && method === 'POST') {
    const wtName = integrateMatch[1];
    const { merge_to = 'main' } = body;
    try {
      const out = await runSchwiRunner(['cleanup-wt', '--wt', wtName, '--merge-to', merge_to]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, output: out.stdout }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // API: Discard / Cleanup without merge
  const cleanupMatch = pathname.match(/^\/api\/worktrees\/([^/]+)\/cleanup$/);
  if (cleanupMatch && method === 'POST') {
    const wtName = cleanupMatch[1];
    try {
      const out = await runSchwiRunner(['cleanup-wt', '--wt', wtName]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, output: out.stdout }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Static File Serving
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // Default fallback to index.html
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(indexPath).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found\n');
});

// Determine Bind Host & Port
const ARG_HOST = process.argv.find((a, i) => i > 1 && process.argv[i - 1] === '--host');
const ARG_PORT = process.argv.find((a, i) => i > 1 && process.argv[i - 1] === '--port');
const isVps = isVpsMode();
const cfg = readConfig();

const bindPort = ARG_PORT
  ? parseInt(ARG_PORT, 10)
  : parseInt(process.env.SCHWI_PORT || process.env.PORT || cfg.port || '3456', 10);

let bindHost = ARG_HOST || process.env.SCHWI_HOST;

if (!bindHost) {
  if (isVps) {
    const tsIp = getTailscaleIp();
    if (tsIp) {
      bindHost = tsIp;
    } else {
      bindHost = '127.0.0.1';
    }
  } else {
    bindHost = '127.0.0.1';
  }
}

server.listen(bindPort, bindHost, () => {
  console.log('====================================================');
  console.log('  ⚡ Schwi Swarm Web Controller');
  console.log(`  Mode: ${isVps ? 'VPS Mode (Active)' : 'Local Mode'}`);
  console.log(`  URL:  http://${bindHost}:${bindPort}`);
  if (isVps) {
    const tsIp = getTailscaleIp();
    if (tsIp) {
      console.log(`  Tailscale: Connected (IP: ${tsIp})`);
    } else {
      console.log('  Tailscale: Not detected (Bound to 127.0.0.1)');
      console.log('  Tip: Run "sudo tailscale up" to connect VPS to your Tailnet.');
    }
    console.log('  Security: Locked to Tailscale & Localhost');
  } else {
    console.log('  Network: Localhost (127.0.0.1)');
    console.log('  Security: Localhost Only');
  }
  console.log('====================================================');
});
