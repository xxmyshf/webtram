import fs from 'fs';
import path from 'path';

export interface StoredSessionMeta {
  id: string;
  title: string;
  scope?: string;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: number;
  lastActiveAt: number;
  incarnation: number;
  logFile: string;
}

export interface StoredManifest {
  version: number;
  updatedAt: number;
  sessions: StoredSessionMeta[];
}

export class SessionStore {
  private readonly dataDir: string;
  private readonly sessionsDir: string;
  private readonly logsDir: string;
  private readonly manifestFile: string;
  private readonly maxLogBytes: number;

  constructor(
    customDataDir?: string,
    maxLogBytes = 2 * 1024 * 1024 // 2MB rolling scrollback buffer per session
  ) {
    const baseDir = customDataDir
      || process.env.WEBTERM_DATA_DIR
      || path.join(process.env.HOME || process.cwd(), '.webterm');
    this.dataDir = path.resolve(baseDir);
    this.sessionsDir = path.join(this.dataDir, 'sessions');
    this.logsDir = path.join(this.sessionsDir, 'logs');
    this.manifestFile = path.join(this.sessionsDir, 'sessions.json');
    this.maxLogBytes = maxLogBytes;

    this.ensureDirs();
  }

  private ensureDirs(): void {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      if (!fs.existsSync(this.sessionsDir)) {
        fs.mkdirSync(this.sessionsDir, { recursive: true });
      }
      if (!fs.existsSync(this.logsDir)) {
        fs.mkdirSync(this.logsDir, { recursive: true });
      }
    } catch (err) {
      console.error('[SessionStore] Failed to initialize storage directories:', err);
    }
  }

  public getProcCwd(pid: number): string | null {
    if (!pid || pid <= 0) return null;
    try {
      if (process.platform === 'linux') {
        const procCwdLink = `/proc/${pid}/cwd`;
        if (fs.existsSync(procCwdLink)) {
          const resolved = fs.readlinkSync(procCwdLink);
          if (resolved && fs.existsSync(resolved)) {
            return resolved;
          }
        }
      }
    } catch {
      // Process might have terminated or lack permissions
    }
    return null;
  }

  public loadManifest(): StoredManifest {
    this.ensureDirs();
    try {
      if (fs.existsSync(this.manifestFile)) {
        const content = fs.readFileSync(this.manifestFile, 'utf-8');
        const parsed = JSON.parse(content);
        if (parsed && Array.isArray(parsed.sessions)) {
          return parsed;
        }
      }
    } catch (err) {
      console.warn('[SessionStore] Could not read sessions manifest, starting fresh:', err);
    }
    return {
      version: 1,
      updatedAt: Date.now(),
      sessions: []
    };
  }

  public saveManifest(sessions: StoredSessionMeta[]): void {
    this.ensureDirs();
    const manifest: StoredManifest = {
      version: 1,
      updatedAt: Date.now(),
      sessions
    };

    const tmpFile = `${this.manifestFile}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
    try {
      fs.writeFileSync(tmpFile, JSON.stringify(manifest, null, 2), 'utf-8');
      fs.renameSync(tmpFile, this.manifestFile);
    } catch (err) {
      console.error('[SessionStore] Failed to write sessions manifest:', err);
      try {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      } catch {}
    }
  }

  private getLogPath(sessionId: string): string {
    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.logsDir, `${safeId}.log`);
  }

  public appendLog(sessionId: string, chunk: string): void {
    if (!chunk) return;
    const logPath = this.getLogPath(sessionId);
    try {
      fs.appendFileSync(logPath, chunk, 'utf-8');

      // Check log size occasionally (every ~50KB) and truncate head if exceeded
      const stat = fs.statSync(logPath);
      if (stat.size > this.maxLogBytes * 1.5) {
        this.trimLogFile(logPath);
      }
    } catch {
      // Non-fatal, do not crash PTY loop
    }
  }

  private trimLogFile(logPath: string): void {
    try {
      const fd = fs.openSync(logPath, 'r+');
      const stat = fs.fstatSync(fd);
      const readSize = Math.min(stat.size, this.maxLogBytes);
      const buffer = Buffer.alloc(readSize);
      fs.readSync(fd, buffer, 0, readSize, stat.size - readSize);
      fs.closeSync(fd);

      // Find first newline to avoid splitting escape sequences
      const firstNewline = buffer.indexOf('\n');
      const cleanSlice = firstNewline !== -1 ? buffer.subarray(firstNewline + 1) : buffer;

      fs.writeFileSync(logPath, cleanSlice);
    } catch {
      // Ignore trim error
    }
  }

  public readLog(sessionId: string, maxBytes = 256 * 1024): string {
    const logPath = this.getLogPath(sessionId);
    try {
      if (!fs.existsSync(logPath)) return '';
      const stat = fs.statSync(logPath);
      const toRead = Math.min(stat.size, maxBytes);
      if (toRead <= 0) return '';

      const fd = fs.openSync(logPath, 'r');
      const buffer = Buffer.alloc(toRead);
      fs.readSync(fd, buffer, 0, toRead, stat.size - toRead);
      fs.closeSync(fd);

      return buffer.toString('utf-8');
    } catch (err) {
      console.warn(`[SessionStore] Failed to read log for ${sessionId}:`, err);
      return '';
    }
  }

  public pruneSession(sessionId: string): void {
    const logPath = this.getLogPath(sessionId);
    try {
      if (fs.existsSync(logPath)) {
        fs.unlinkSync(logPath);
      }
    } catch (err) {
      console.warn(`[SessionStore] Failed to delete log for ${sessionId}:`, err);
    }
  }
}
