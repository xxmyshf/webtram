import express from 'express';
import http from 'http';
import https from 'https';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { PtyManager } from './pty-manager.js';
import { setupWebSocketServer } from './websocket-server.js';
import { asrRouter } from './asr-service.js';
import { ensureCertificates } from './cert-utils.js';
import { parseCliArgs, printHelp } from './cli-args.js';
import { getStoredPasswordHash, updatePassword, verifyPassword } from './auth.js';
import { ensureRuntimeEnvironment, ensureNativePtyBinary } from './embedded-assets.js';
import { FsManager } from './fs-manager.js';

// Parse command-line arguments (-p/--port, -P/--password, --hash, -h/--help)
const cliArgs = parseCliArgs();

if (cliArgs.help) {
  printHelp();
  process.exit(0);
}

const projectRoot = process.env.WEBTERM_ROOT || process.cwd();

// Auto generate .env and dist/ static assets if missing (passing initial password hash if specified)
ensureRuntimeEnvironment(projectRoot, cliArgs.initialHash);
ensureNativePtyBinary();

// Load .env.local first (higher priority), then .env
const localEnv = path.resolve(projectRoot, '.env.local');
if (fs.existsSync(localEnv)) {
  dotenv.config({ path: localEnv });
}
dotenv.config({ path: path.resolve(projectRoot, '.env') });

// If CLI or environment specified password/hash, override and persist to .env
if (cliArgs.initialHash) {
  updatePassword(cliArgs.initialHash);
  console.log(`[Auth] 命令行指定初始访问凭据已生效 (SHA-256: ${cliArgs.initialHash.slice(0, 8)}...)`);
}

const app = express();

const PORT = cliArgs.port ?? parseInt(process.env.PORT || '13399', 10);
const HOST = '0.0.0.0';
const ENABLE_HTTPS = process.env.ENABLE_HTTPS !== 'false';

const certPath = process.env.SSL_CERT_PATH
  ? path.resolve(projectRoot, process.env.SSL_CERT_PATH)
  : path.join(projectRoot, 'certs', 'cert.pem');

const keyPath = process.env.SSL_KEY_PATH
  ? path.resolve(projectRoot, process.env.SSL_KEY_PATH)
  : path.join(projectRoot, 'certs', 'key.pem');

let server: http.Server | https.Server;
let isHttpsActive = false;

if (ENABLE_HTTPS) {
  try {
    const { key, cert } = ensureCertificates(certPath, keyPath);
    server = https.createServer({ key, cert }, app);
    isHttpsActive = true;
    console.log('[SSL] HTTPS enabled with SSL/TLS certificate.');
  } catch (err) {
    console.error('[SSL] Failed to initialize HTTPS, falling back to HTTP:', err);
    server = http.createServer(app);
    isHttpsActive = false;
  }
} else {
  server = http.createServer(app);
  isHttpsActive = false;
  console.log('[Server] Running in HTTP mode (ENABLE_HTTPS=false).');
}

// Enable CORS & body parsing
app.use(cors());
app.use(express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '25mb' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// PTY Session Manager
const ptyManager = new PtyManager();

// Track all active TCP sockets to allow fast, graceful shutdown
const openSockets = new Set<import('net').Socket>();
server.on('connection', (socket: import('net').Socket) => {
  openSockets.add(socket);
  socket.on('close', () => openSockets.delete(socket));
});
if (isHttpsActive) {
  server.on('secureConnection', (socket: import('net').Socket) => {
    openSockets.add(socket);
    socket.on('close', () => openSockets.delete(socket));
  });
}

// Setup File System Manager
const fsManager = new FsManager(projectRoot);

// Setup WebSocket server
const wss = setupWebSocketServer(server, ptyManager, fsManager);

// ASR Audio Routes
app.use('/api/asr', asrRouter);

// File System Download & Raw Content Routes
app.get('/api/fs/download', (req, res) => {
  const { path: targetPath, pwd } = req.query;
  if (!pwd || !verifyPassword(String(pwd))) {
    return res.status(401).send('Unauthorized');
  }
  try {
    const resolved = fsManager.resolvePath(String(targetPath));
    if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
      return res.status(404).send('File not found');
    }
    res.download(resolved);
  } catch (err: any) {
    res.status(500).send(err.message || 'Download error');
  }
});

app.get('/api/fs/raw', (req, res) => {
  const { path: targetPath, pwd } = req.query;
  if (!pwd || !verifyPassword(String(pwd))) {
    return res.status(401).send('Unauthorized');
  }
  try {
    const resolved = fsManager.resolvePath(String(targetPath));
    if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
      return res.status(404).send('File not found');
    }
    res.sendFile(resolved);
  } catch (err: any) {
    res.status(500).send(err.message || 'File read error');
  }
});

app.post('/api/fs/upload', (req, res) => {
  const pwd = req.headers['x-webterm-pwd'] || req.query.pwd;
  const targetPath = req.headers['x-webterm-path'] || req.query.path;
  if (!pwd || !verifyPassword(String(pwd))) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  if (!targetPath) {
    return res.status(400).json({ success: false, error: 'Target path required' });
  }
  try {
    const resolved = fsManager.resolvePath(String(targetPath));
    fsManager.writeFile(resolved, req.body);
    res.json({ success: true, path: resolved });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Upload error' });
  }
});

// Health & session info API
app.get('/api/status', (_req, res) => {
  res.json({
    status: 'online',
    uptime: process.uptime(),
    sessions: ptyManager.getAllSessionsInfo()
  });
});

// Password verification API
app.post('/api/auth/verify', (req, res) => {
  const { password } = req.body;
  if (verifyPassword(password)) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: 'Invalid password' });
  }
});

// Change Password API (supports frontend SHA-256 encrypted password)
app.post('/api/auth/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400).json({ success: false, error: 'Both current and new passwords are required' });
    return;
  }

  if (!verifyPassword(currentPassword)) {
    res.status(401).json({ success: false, error: 'Current password verification failed' });
    return;
  }

  if (newPassword.length < 4) {
    res.status(400).json({ success: false, error: 'New password must be at least 4 characters' });
    return;
  }

  updatePassword(newPassword);
  res.json({ success: true, message: 'Password updated successfully' });
});

// Serve frontend build if dist exists
const distPath = path.join(projectRoot, 'dist');
app.use(express.static(distPath));

// Fallback SPA handler for non-API requests
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
    return next();
  }
  const indexPath = path.join(distPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(200).send(`
        <!DOCTYPE html>
        <html>
        <head><title>WebTerm Server</title></head>
        <body style="background:#090d13;color:#00e5ff;font-family:monospace;padding:40px;">
          <h2>Cyberpunk WebTerm Server is running.</h2>
          <p>Please run <code>npm run dev</code> for frontend development or <code>npm run build</code> to generate the client.</p>
        </body>
        </html>
      `);
    }
  });
});

// Graceful shutdown
let isShuttingDown = false;

function shutdown() {
  if (isShuttingDown) {
    console.log('[Server] Force exiting immediately...');
    process.exit(0);
  }
  isShuttingDown = true;
  console.log('[Server] Shutting down gracefully...');

  // Fallback hard exit after 800ms if any native handle blocks the event loop
  const forceTimer = setTimeout(() => {
    console.log('[Server] Shutdown timeout reached. Exiting now.');
    process.exit(0);
  }, 800);
  forceTimer.unref();

  // 1. Destroy all PTY child processes and clean timers
  try {
    ptyManager.destroyAllSessions();
  } catch (err) {
    console.error('[Server] Error destroying PTY sessions:', err);
  }

  // 2. Terminate all active WebSocket clients & close WSS
  try {
    for (const client of wss.clients) {
      try {
        client.terminate();
      } catch {}
    }
    wss.close();
  } catch (err) {
    console.error('[Server] Error closing WebSocket server:', err);
  }

  // 3. Destroy all tracked open sockets (HTTP/HTTPS keep-alive)
  for (const socket of openSockets) {
    try {
      socket.destroy();
    } catch {}
  }
  openSockets.clear();

  // 4. Close HTTP/HTTPS server
  if (typeof (server as any).closeAllConnections === 'function') {
    (server as any).closeAllConnections();
  }

  server.close(() => {
    console.log('[Server] Server and WebSocket closed.');
    clearTimeout(forceTimer);
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, HOST, () => {
  const protocol = isHttpsActive ? 'https' : 'http';
  const wsProtocol = isHttpsActive ? 'wss' : 'ws';
  console.log(`=================================================`);
  console.log(`🚀 Cyberpunk WebTerm Server running at ${protocol}://${HOST}:${PORT}`);
  console.log(`🔒 Access Authentication: SHA-256 Hash Protected (${getStoredPasswordHash().slice(0, 8)}...)`);
  console.log(`🔌 WebSocket Endpoint: ${wsProtocol}://${HOST}:${PORT}/ws`);
  console.log(`🎙️ ASR Endpoint: ${protocol}://${HOST}:${PORT}/api/asr`);
  if (isHttpsActive) {
    console.log(`📜 SSL Certificate: ${certPath}`);
  }
  console.log(`=================================================`);
});
