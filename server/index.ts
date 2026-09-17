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
import { getStoredPasswordHash } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Load .env.local first (higher priority), then .env
const localEnv = path.resolve(projectRoot, '.env.local');
if (fs.existsSync(localEnv)) {
  dotenv.config({ path: localEnv });
}
dotenv.config({ path: path.resolve(projectRoot, '.env') });

const app = express();

const PORT = parseInt(process.env.PORT || '3000', 10);
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

// Setup WebSocket server
setupWebSocketServer(server, ptyManager);

// ASR Audio Routes
app.use('/api/asr', asrRouter);

// Health & session info API
app.get('/api/status', (_req, res) => {
  res.json({
    status: 'online',
    uptime: process.uptime(),
    sessions: ptyManager.getAllSessionsInfo()
  });
});

import { verifyPassword, updatePassword } from './auth.js';

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
function shutdown() {
  console.log('[Server] Shutting down gracefully...');
  server.close(() => {
    console.log('[Server] Server and WebSocket closed.');
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
