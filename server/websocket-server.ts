import { Server as HttpServer } from 'http';
import { Server as HttpsServer } from 'https';
import { WebSocketServer, WebSocket } from 'ws';
import { PtyManager } from './pty-manager.js';

import { verifyPassword } from './auth.js';

interface ClientContext {
  ws: WebSocket;
  authenticated: boolean;
  primarySessionId: string | null;
  activeSessions: Set<string>;
  lastPing: number;
}

export function setupWebSocketServer(httpServer: HttpServer | HttpsServer, ptyManager: PtyManager): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  console.log(`[WebSocket] Server initialized on /ws (Auth required)`);

  const broadcastAuthenticated = (msg: object) => {
    const payload = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
        } catch {}
      }
    }
  };

  wss.on('connection', (ws: WebSocket, req) => {
    const ip = req.socket.remoteAddress || 'unknown';
    console.log(`[WebSocket] New incoming connection from ${ip}`);

    const ctx: ClientContext = {
      ws,
      authenticated: false,
      primarySessionId: null,
      activeSessions: new Set<string>(),
      lastPing: Date.now()
    };

    ws.on('message', (messageRaw: string | Buffer) => {
      try {
        const text = messageRaw.toString('utf-8');
        const payload = JSON.parse(text);

        switch (payload.type) {
          case 'auth': {
            const { password, sessionId, cols, rows, title } = payload;
            if (!verifyPassword(password)) {
              console.warn(`[WebSocket] Auth failure from ${ip}`);
              ws.send(JSON.stringify({
                type: 'auth_fail',
                error: 'Invalid password. Access denied.'
              }));
              return;
            }

            // Auth succeeded
            ctx.authenticated = true;
            const targetSessionId = (sessionId && typeof sessionId === 'string' && sessionId.trim().length > 0)
              ? sessionId.trim()
              : `term-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;

            ctx.primarySessionId = targetSessionId;
            ctx.activeSessions.add(targetSessionId);

            const initialCols = cols && Number.isInteger(cols) ? cols : 80;
            const initialRows = rows && Number.isInteger(rows) ? rows : 24;

            const session = ptyManager.getOrCreateSession(targetSessionId, initialCols, initialRows, title);
            ptyManager.attachClient(targetSessionId, ws);

            console.log(`[WebSocket] Client authenticated for session ${targetSessionId} (${session.title})`);

            ws.send(JSON.stringify({
              type: 'auth_ok',
              sessionId: targetSessionId,
              title: session.title,
              cols: session.cols,
              rows: session.rows,
              sessions: ptyManager.getAllSessions()
            }));

            // Replay history if existing
            const history = session.ringBuffer.getReplayData();
            if (history) {
              ws.send(JSON.stringify({
                type: 'history',
                sessionId: targetSessionId,
                data: history
              }));
            }
            break;
          }

          case 'session_list': {
            if (!ctx.authenticated) return;
            ws.send(JSON.stringify({
              type: 'session_list',
              sessions: ptyManager.getAllSessions()
            }));
            break;
          }

          case 'session_create': {
            if (!ctx.authenticated) return;
            const { title, cols, rows } = payload;
            const newSessionId = `term-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
            const initialCols = cols && Number.isInteger(cols) ? cols : 80;
            const initialRows = rows && Number.isInteger(rows) ? rows : 24;

            const newSession = ptyManager.getOrCreateSession(newSessionId, initialCols, initialRows, title);
            ptyManager.attachClient(newSessionId, ws);
            ctx.activeSessions.add(newSessionId);

            console.log(`[WebSocket] Created new session ${newSessionId} (${newSession.title})`);

            ws.send(JSON.stringify({
              type: 'session_created',
              sessionId: newSessionId,
              title: newSession.title,
              cols: newSession.cols,
              rows: newSession.rows,
              sessions: ptyManager.getAllSessions()
            }));

            // Broadcast updated session list to all clients
            broadcastAuthenticated({
              type: 'session_list_updated',
              sessions: ptyManager.getAllSessions()
            });
            break;
          }

          case 'session_attach': {
            if (!ctx.authenticated) return;
            const targetSessionId = payload.sessionId;
            if (!targetSessionId) return;

            const cols = payload.cols && Number.isInteger(payload.cols) ? payload.cols : 80;
            const rows = payload.rows && Number.isInteger(payload.rows) ? payload.rows : 24;

            const session = ptyManager.getOrCreateSession(targetSessionId, cols, rows);
            ptyManager.attachClient(targetSessionId, ws);
            ctx.activeSessions.add(targetSessionId);

            ws.send(JSON.stringify({
              type: 'session_attached',
              sessionId: targetSessionId,
              title: session.title,
              cols: session.cols,
              rows: session.rows
            }));

            const history = session.ringBuffer.getReplayData();
            if (history) {
              ws.send(JSON.stringify({
                type: 'history',
                sessionId: targetSessionId,
                data: history
              }));
            }
            break;
          }

          case 'session_rename': {
            if (!ctx.authenticated) return;
            const { sessionId, title } = payload;
            if (sessionId && title && typeof title === 'string') {
              const ok = ptyManager.renameSession(sessionId, title);
              if (ok) {
                broadcastAuthenticated({
                  type: 'session_renamed',
                  sessionId,
                  title,
                  sessions: ptyManager.getAllSessions()
                });
              }
            }
            break;
          }

          case 'session_kill': {
            if (!ctx.authenticated) return;
            const { sessionId } = payload;
            if (sessionId) {
              console.log(`[WebSocket] Kill session request for ${sessionId}`);
              ctx.activeSessions.delete(sessionId);
              ptyManager.destroySession(sessionId);
              broadcastAuthenticated({
                type: 'session_list_updated',
                sessions: ptyManager.getAllSessions()
              });
            }
            break;
          }

          case 'input': {
            if (!ctx.authenticated) {
              ws.send(JSON.stringify({ type: 'error', error: 'Unauthenticated session' }));
              return;
            }
            const targetSession = payload.sessionId || ctx.primarySessionId;
            if (targetSession && typeof payload.data === 'string') {
              ptyManager.write(targetSession, payload.data);
            }
            break;
          }

          case 'resize': {
            if (!ctx.authenticated) return;
            const targetSession = payload.sessionId || ctx.primarySessionId;
            const { cols, rows } = payload;
            if (targetSession && cols > 0 && rows > 0) {
              ptyManager.resize(targetSession, cols, rows);
            }
            break;
          }

          case 'ping': {
            ws.send(JSON.stringify({
              type: 'pong',
              ts: payload.ts || Date.now()
            }));
            break;
          }

          default:
            console.warn(`[WebSocket] Unknown message type: ${payload.type}`);
        }
      } catch (err: any) {
        console.error('[WebSocket] Message parsing error:', err);
      }
    });

    ws.on('close', () => {
      for (const sid of ctx.activeSessions) {
        ptyManager.detachClient(sid, ws);
      }
      ctx.activeSessions.clear();
    });

    ws.on('error', (err) => {
      console.error('[WebSocket] Socket error:', err);
      for (const sid of ctx.activeSessions) {
        ptyManager.detachClient(sid, ws);
      }
      ctx.activeSessions.clear();
    });
  });

  return wss;
}
