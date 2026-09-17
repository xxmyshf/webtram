import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envLocalPath = path.resolve(__dirname, '../.env.local');
const envPath = path.resolve(__dirname, '../.env');

export function sha256(str: string): string {
  return crypto.createHash('sha256').update(str).digest('hex').toLowerCase();
}

export function isSha256Hex(str: string): boolean {
  return typeof str === 'string' && /^[0-9a-f]{64}$/i.test(str.trim());
}

export function getStoredPasswordHash(): string {
  const hashFromEnv = process.env.TERMINAL_PASSWORD_HASH;
  if (hashFromEnv && isSha256Hex(hashFromEnv)) {
    return hashFromEnv.trim().toLowerCase();
  }

  const legacyPwd = process.env.TERMINAL_PASSWORD;
  if (legacyPwd) {
    if (isSha256Hex(legacyPwd)) {
      return legacyPwd.trim().toLowerCase();
    }
    return sha256(legacyPwd);
  }

  // Default hash for '12345678'
  return sha256('12345678');
}

export function verifyPassword(input: string): boolean {
  if (!input) return false;
  const storedHash = getStoredPasswordHash();
  const normalizedInput = input.trim().toLowerCase();

  // If client provided a 64-char hex SHA-256 hash
  if (isSha256Hex(normalizedInput)) {
    return normalizedInput === storedHash;
  }

  // If client provided plaintext, hash it and verify
  return sha256(input) === storedHash;
}

export function updatePassword(newPassword: string): void {
  const newHash = isSha256Hex(newPassword) ? newPassword.trim().toLowerCase() : sha256(newPassword);

  // Update in-memory environment variables
  process.env.TERMINAL_PASSWORD_HASH = newHash;
  delete process.env.TERMINAL_PASSWORD;

  // Prioritize .env.local if it exists, otherwise fall back to .env
  const targetPath = fs.existsSync(envLocalPath) ? envLocalPath : envPath;

  try {
    let content = '';
    if (fs.existsSync(targetPath)) {
      content = fs.readFileSync(targetPath, 'utf-8');
    }

    // Strip out any legacy plaintext TERMINAL_PASSWORD lines
    content = content.replace(/^TERMINAL_PASSWORD=.*$/gm, '');

    // Replace or append TERMINAL_PASSWORD_HASH
    if (/^TERMINAL_PASSWORD_HASH=.*$/m.test(content)) {
      content = content.replace(/^TERMINAL_PASSWORD_HASH=.*$/m, `TERMINAL_PASSWORD_HASH=${newHash}`);
    } else {
      content = content.trim() + `\nTERMINAL_PASSWORD_HASH=${newHash}\n`;
    }

    fs.writeFileSync(targetPath, content.trim() + '\n', 'utf-8');
    console.log(`[Auth] Password hash updated and safely persisted to ${path.basename(targetPath)} (plaintext never saved)`);
  } catch (err) {
    console.error(`[Auth] Failed to write password hash to ${targetPath}:`, err);
  }
}
