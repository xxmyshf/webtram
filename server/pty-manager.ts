import { getPty, IPty } from './pty-adapter.js';
import { WebSocket } from 'ws';
import { RingBuffer } from './ring-buffer.js';

export interface TerminalSession {
  id: string;
  title: string;
  ptyProcess: IPty;
  ringBuffer: RingBuffer;
  clients: Set<WebSocket>;
  cols: number;
  rows: number;
  createdAt: number;
  lastActiveAt: number;
  cleanupTimer: NodeJS.Timeout | null;
}

export class PtyManager {
  private sessions = new Map<string, TerminalSession>();
  private readonly defaultShell: string;
  private readonly maxHistoryLines: number;
  private readonly timeoutMs: number;

  constructor(
    defaultShell = process.env.DEFAULT_SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'),
    maxHistoryLines = parseInt(process.env.MAX_HISTORY_LINES || '2000', 10),
    // Default 0 means persistent / never kill on disconnect (like tmux server)
    timeoutMinutes = parseInt(process.env.SESSION_TIMEOUT_MINUTES || '0', 10)
  ) {
    this.defaultShell = defaultShell;
    this.maxHistoryLines = maxHistoryLines;
    this.timeoutMs = timeoutMinutes > 0 ? timeoutMinutes * 60 * 1000 : 0;
  }

  public getOrCreateSession(sessionId: string, initialCols = 80, initialRows = 24, initialTitle?: string): TerminalSession {
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
      return session;
    }

    const defaultTitle = initialTitle || `term-${this.sessions.size + 1}`;
    console.log(`[PtyManager] Creating new session: ${sessionId} (${defaultTitle}, ${initialCols}x${initialRows})`);
    const ringBuffer = new RingBuffer(this.maxHistoryLines);

    const env = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: process.env.LANG || 'en_US.UTF-8'
    };

    const ptyMod = getPty();
    const ptyProcess = ptyMod.spawn(this.defaultShell, [], {
      name: 'xterm-256color',
      cols: initialCols,
      rows: initialRows,
      cwd: process.env.HOME || process.cwd(),
      env: env as { [key: string]: string }
    });

    session = {
      id: sessionId,
      title: defaultTitle,
      ptyProcess,
      ringBuffer,
      clients: new Set<WebSocket>(),
      cols: initialCols,
      rows: initialRows,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      cleanupTimer: null
    };

    ptyProcess.onData((data: string) => {
      session!.ringBuffer.write(data);
      session!.lastActiveAt = Date.now();

      const message = JSON.stringify({
        type: 'output',
        sessionId,
        data
      });

      for (const client of session!.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      }
    });

    ptyProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
      console.log(`[PtyManager] Process exited for session ${sessionId}: code=${exitCode}, signal=${signal}`);
      const exitMsg = JSON.stringify({
        type: 'exit',
        sessionId,
        exitCode,
        signal
      });

      for (const client of session!.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(exitMsg);
        }
      }
      this.destroySession(sessionId);
    });

    this.sessions.set(sessionId, session);
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
    console.log(`[PtyManager] Destroyed session: ${sessionId}`);
  }

  public destroyAllSessions(): void {
    for (const id of Array.from(this.sessions.keys())) {
      this.destroySession(id);
    }
  }

  public getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  public getAllSessions(): Array<{ id: string; title: string; cols: number; rows: number; createdAt: number; lastActiveAt: number; clientCount: number }> {
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      title: s.title,
      cols: s.cols,
      rows: s.rows,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
      clientCount: s.clients.size
    }));
  }

  public getAllSessionsInfo(): Array<{ id: string; clientCount: number; ageMinutes: number }> {
    const now = Date.now();
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      clientCount: s.clients.size,
      ageMinutes: Math.floor((now - s.createdAt) / 60000)
    }));
  }
}
