import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

/**
 * Collects local IP addresses to include in the Subject Alternative Name (SAN)
 * so that LAN devices (like mobile phones) won't suffer IP mismatch errors.
 */
export function getSubjectAltNames(): string[] {
  const altNames: Set<string> = new Set(['DNS:localhost', 'IP:127.0.0.1', 'IP:::1']);

  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const netList = interfaces[name];
    if (!netList) continue;
    for (const net of netList) {
      if (net.family === 'IPv4') {
        altNames.add(`IP:${net.address}`);
      }
    }
  }

  return Array.from(altNames);
}

/**
 * Generates a self-signed RSA 2048-bit certificate with SAN extensions using OpenSSL.
 */
export function generateSelfSignedCert(
  certPath: string,
  keyPath: string,
  days = 365
): { certPath: string; keyPath: string } {
  const certDir = path.dirname(certPath);
  const keyDir = path.dirname(keyPath);

  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
  }
  if (!fs.existsSync(keyDir)) {
    fs.mkdirSync(keyDir, { recursive: true });
  }

  const sanList = getSubjectAltNames().join(',');
  console.log(`[SSL] Generating self-signed SSL/TLS certificate...`);
  console.log(`[SSL] Subject Alternative Names (SAN): ${sanList}`);

  // OpenSSL command to generate self-signed certificate with SAN extension
  const opensslCmd = [
    'openssl req -x509 -nodes -newkey rsa:2048 -sha256',
    `-days ${days}`,
    `-keyout "${keyPath}"`,
    `-out "${certPath}"`,
    '-subj "/CN=WebTerm/O=Cyberpunk/OU=Terminal"',
    `-addext "subjectAltName = ${sanList}"`
  ].join(' ');

  try {
    execSync(opensslCmd, { stdio: 'inherit' });
    console.log(`[SSL] ✅ Certificate created successfully:`);
    console.log(`      Key : ${keyPath}`);
    console.log(`      Cert: ${certPath}`);
    return { certPath, keyPath };
  } catch (err) {
    console.error('[SSL] ❌ Failed to generate certificate with openssl:', err);
    throw err;
  }
}

/**
 * Ensures certificates exist. If missing, automatically generates them.
 * Returns the key and cert buffers for https.createServer.
 */
export function ensureCertificates(
  certPath: string,
  keyPath: string
): { key: Buffer; cert: Buffer } {
  const certExists = fs.existsSync(certPath);
  const keyExists = fs.existsSync(keyPath);

  if (!certExists || !keyExists) {
    console.log(`[SSL] Certificate or private key missing. Generating new self-signed certificate...`);
    generateSelfSignedCert(certPath, keyPath);
  }

  const key = fs.readFileSync(keyPath);
  const cert = fs.readFileSync(certPath);

  return { key, cert };
}
