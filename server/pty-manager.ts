import fs from 'fs';
import { getPty, IPty } from './pty-adapter.js';
import { WebSocket } from 'ws';
import { RingBuffer } from './ring-buffer.js';
import { SessionStore, StoredSessionMeta } from './session-store.js';

export interface TerminalSession {
  id: string;
  scope?: string;
  title: string;
  ptyProcess: IPty;
  ringBuffer: RingBuffer;
  clients: Set<WebSocket>;
  cols: number;
  rows: number;
  createdAt: number;
  lastActiveAt: number;
  cwd: string;
  incarnation: number;
  cleanupTimer: NodeJS.Timeout | null;
}

export class PtyManager {
  private sessions = new Map<string, TerminalSession>();
  private readonly defaultShell: string;
  private readonly maxHistoryLines: number;
  private readonly timeoutMs: number;
  private readonly sessionStore: SessionStore;
  private periodicPersistTimer: NodeJS.Timeout | null = null;

  constructor(
    defaultShell = process.env.DEFAULT_SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'),
    maxHistoryLines = parseInt(process.env.MAX_HISTORY_LINES || '2000', 10),
    // Default 0 means persistent / never kill on disconnect (like tmux server)
    timeoutMinutes = parseInt(process.env.SESSION_TIMEOUT_MINUTES || '0', 10)
  ) {
    this.defaultShell = defaultShell;
    this.maxHistoryLines = maxHistoryLines;
    this.timeoutMs = timeoutMinutes > 0 ? timeoutMinutes * 60 * 1000 : 0;
    this.sessionStore = new SessionStore();

    // Cold Restore: hydrate persistent sessions from disk
    this.restoreSessionsFromDisk();

    // Periodic state synchronization (every 10s)
    this.periodicPersistTimer = setInterval(() => {
      this.persistAllSessions();
    }, 10000);
    this.periodicPersistTimer.unref();
  }

  public getSessionStore(): SessionStore {
    return this.sessionStore;
  }

  private createEnv(): { [key: string]: string } {
    return {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: process.env.LANG || 'en_US.UTF-8'
    } as { [key: string]: string };
  }

  /**
   * Cold Restore (Orca Architecture Pillar 4):
   * Restores terminal sessions, tabs, and rolling scrollback across app exits & system reboots.
   */
  public restoreSessionsFromDisk(): void {
    const manifest = this.sessionStore.loadManifest();
    if (!manifest || !manifest.sessions || manifest.sessions.length === 0) {
      return;
    }

    console.log(`[PtyManager] Cold Restore: Found ${manifest.sessions.length} persisted session(s) on disk.`);

    for (const meta of manifest.sessions) {
      try {
        let effectiveCwd = meta.cwd;
        if (!effectiveCwd || !fs.existsSync(effectiveCwd)) {
          effectiveCwd = process.env.HOME || process.cwd();
        }

        const cols = meta.cols || 80;
        const rows = meta.rows || 24;
        const ringBuffer = new RingBuffer(this.maxHistoryLines);

        // 1. Rehydrate historical scrollback from persistent log
        const savedLog = this.sessionStore.readLog(meta.id, 512 * 1024);
        if (savedLog) {
          ringBuffer.write(savedLog);
        }

        // 2. Append Cold Restore banner
        const banner = `\r\n\x1b[90m--- [WebTerm] Session restored from previous run (cwd: ${effectiveCwd}) ---\x1b[0m\r\n`;
        ringBuffer.write(banner);

        // 3. Spawn fresh PTY incarnation in the exact saved working directory
        const ptyMod = getPty();
        const ptyProcess = ptyMod.spawn(this.defaultShell, [], {
          name: 'xterm-256color',
          cols,
          rows,
          cwd: effectiveCwd,
          env: this.createEnv()
        });

        const newIncarnation = (meta.incarnation || 1) + 1;
        const session: TerminalSession = {
          id: meta.id,
          scope: meta.scope,
          title: meta.title,
          ptyProcess,
          ringBuffer,
          clients: new Set<WebSocket>(),
          cols,
          rows,
          createdAt: meta.createdAt || Date.now(),
          lastActiveAt: Date.now(),
          cwd: effectiveCwd,
          incarnation: newIncarnation,
          cleanupTimer: null
        };

        this.attachPtyEvents(session);
        this.sessions.set(meta.id, session);
        console.log(`[PtyManager] Restored session ${meta.id} (title: "${meta.title}", cwd: ${effectiveCwd}, incarnation: ${newIncarnation})`);
      } catch (err) {
        console.error(`[PtyManager] Failed to cold restore session ${meta.id}:`, err);
      }
    }
  }

  private attachPtyEvents(session: TerminalSession): void {
    const sessionId = session.id;

    session.ptyProcess.onData((data: string) => {
      session.ringBuffer.write(data);
      session.lastActiveAt = Date.now();
      // Write-ahead append-only log to disk
      this.sessionStore.appendLog(sessionId, data);

      const message = JSON.stringify({
        type: 'output',
        sessionId,
        data
      });

      for (const client of session.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      }
    });

    session.ptyProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
      console.log(`[PtyManager] Process exited for session ${sessionId}: code=${exitCode}, signal=${signal}`);
      const exitMsg = JSON.stringify({
        type: 'exit',
        sessionId,
        exitCode,
        signal
      });

      for (const client of session.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(exitMsg);
        }
      }
      this.destroySession(sessionId);
    });
  }

  public updateSessionCwd(sessionId: string): string | null {
    const session = this.sessions.get(sessionId);
    if (!session || !session.ptyProcess) return null;
    const pid = (session.ptyProcess as any).pid;
    const currentCwd = this.sessionStore.getProcCwd(pid);
    if (currentCwd && currentCwd !== session.cwd) {
      session.cwd = currentCwd;
    }
    return session.cwd;
  }

  public persistAllSessions(): void {
    const list: StoredSessionMeta[] = [];
    for (const session of this.sessions.values()) {
      this.updateSessionCwd(session.id);
      list.push({
        id: session.id,
        title: session.title,
        scope: session.scope,
        cwd: session.cwd,
        cols: session.cols,
        rows: session.rows,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        incarnation: session.incarnation,
        logFile: `logs/${session.id}.log`
      });
    }
    this.sessionStore.saveManifest(list);
  }

  public getOrCreateSession(
    sessionId: string,
    initialCols = 80,
    initialRows = 24,
    initialTitle?: string,
    scope?: string,
    initialCwd?: string
  ): TerminalSession {
    let session = this.sessions.get(sessionId);

    if (session) {
      // Cancel pending destruction timer if client reconnected
      if (session.cleanupTimer) {
        clearTimeout(session.cleanupTimer);
        session.cleanupTimer = null;
        console.log(`[PtyManager] Session resumed: ${sessionId}`);
      }
      session.lastActiveAt = Date.now();
      if (initialTitle) {
        session.title = initialTitle;
      }
      if (scope && !session.scope) {
        session.scope = scope;
      }
      return session;
    }

    const defaultTitle = initialTitle || `term-${this.sessions.size + 1}`;
    console.log(`[PtyManager] Creating new session: ${sessionId} (${defaultTitle}, ${initialCols}x${initialRows})`);
    const ringBuffer = new RingBuffer(this.maxHistoryLines);

    let effectiveCwd = initialCwd || process.env.HOME || process.cwd();
    if (!fs.existsSync(effectiveCwd)) {
      effectiveCwd = process.env.HOME || process.cwd();
    }

    const ptyMod = getPty();
    const ptyProcess = ptyMod.spawn(this.defaultShell, [], {
      name: 'xterm-256color',
      cols: initialCols,
      rows: initialRows,
      cwd: effectiveCwd,
      env: this.createEnv()
    });

    session = {
      id: sessionId,
      scope: scope || undefined,
      title: defaultTitle,
      ptyProcess,
      ringBuffer,
      clients: new Set<WebSocket>(),
      cols: initialCols,
      rows: initialRows,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      cwd: effectiveCwd,
      incarnation: 1,
      cleanupTimer: null
    };

    this.attachPtyEvents(session);
    this.sessions.set(sessionId, session);
    this.persistAllSessions();
    return session;
  }

  public attachClient(sessionId: string, ws: WebSocket): TerminalSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Prune closed sockets for this session
    for (const oldClient of Array.from(session.clients)) {
      if (oldClient !== ws && (oldClient.readyState === WebSocket.CLOSED || oldClient.readyState === WebSocket.CLOSING)) {
        session.clients.delete(oldClient);
      }
    }

    session.clients.add(ws);
    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
      session.cleanupTimer = null;
    }
    session.lastActiveAt = Date.now();
    return session;
  }

  public detachClient(sessionId: string, ws: WebSocket): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.clients.delete(ws);
    console.log(`[PtyManager] Client detached from session ${sessionId}, remaining clients: ${session.clients.size}`);

    this.updateSessionCwd(sessionId);
    this.persistAllSessions();

    // If no clients left and timeoutMs > 0, schedule session teardown
    // (If timeoutMs === 0, session runs persistently like tmux daemon)
    if (this.timeoutMs > 0 && session.clients.size === 0 && !session.cleanupTimer) {
      console.log(`[PtyManager] Scheduling cleanup for inactive session ${sessionId} in ${this.timeoutMs / 1000}s`);
      session.cleanupTimer = setTimeout(() => {
        console.log(`[PtyManager] Timeout reached for abandoned session ${sessionId}. Destroying.`);
        this.destroySession(sessionId);
      }, this.timeoutMs);
    }
  }

  public write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.ptyProcess.write(data);
      session.lastActiveAt = Date.now();
    }
  }

  public resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (session && cols > 0 && rows > 0) {
      try {
        session.ptyProcess.resize(cols, rows);
        session.cols = cols;
        session.rows = rows;
      } catch (err) {
        console.error(`[PtyManager] Failed to resize session ${sessionId}:`, err);
      }
    }
  }

  public renameSession(sessionId: string, newTitle: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.title = newTitle.trim() || session.title;
    this.persistAllSessions();
    return true;
  }

  public destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
      session.cleanupTimer = null;
    }

    const closeMsg = JSON.stringify({
      type: 'session_closed',
      sessionId
    });
    for (const client of session.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(closeMsg);
        } catch {}
      }
    }

    try {
      session.ptyProcess.kill();
    } catch {
      // already exited
    }

    session.ringBuffer.clear();
    session.clients.clear();
    this.sessions.delete(sessionId);
    this.sessionStore.pruneSession(sessionId);
    this.persistAllSessions();
    console.log(`[PtyManager] Destroyed session: ${sessionId}`);
  }

  public prepareShutdown(): void {
    console.log('[PtyManager] Preparing clean shutdown: syncing CWDs and saving manifest...');
    this.persistAllSessions();

    // Kill PTY child processes cleanly without deleting their persistent scrollback logs
    for (const session of this.sessions.values()) {
      try {
        session.ptyProcess.kill();
      } catch {}
      session.clients.clear();
    }
    this.sessions.clear();
  }

  public destroyAllSessions(): void {
    for (const id of Array.from(this.sessions.keys())) {
      this.destroySession(id);
    }
  }

  public getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  public getSessionsForScope(scope?: string): Array<{ id: string; scope?: string; title: string; cols: number; rows: number; createdAt: number; lastActiveAt: number; clientCount: number; cwd: string }> {
    return Array.from(this.sessions.values())
      .filter(s => {
        if (scope) {
          return s.scope === scope;
        }
        return !s.scope;
      })
      .map(s => ({
        id: s.id,
        scope: s.scope,
        title: s.title,
        cols: s.cols,
        rows: s.rows,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
        clientCount: s.clients.size,
        cwd: s.cwd
      }));
  }

  public getAllSessions(): Array<{ id: string; scope?: string; title: string; cols: number; rows: number; createdAt: number; lastActiveAt: number; clientCount: number; cwd: string }> {
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      scope: s.scope,
      title: s.title,
      cols: s.cols,
      rows: s.rows,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
      clientCount: s.clients.size,
      cwd: s.cwd
    }));
  }

  public getAllSessionsInfo(): Array<{ id: string; clientCount: number; ageMinutes: number; cwd: string }> {
    const now = Date.now();
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      clientCount: s.clients.size,
      ageMinutes: Math.floor((now - s.createdAt) / 60000),
      cwd: s.cwd
    }));
  }
}
