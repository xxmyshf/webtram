import { Server as HttpServer } from 'http';
import { Server as HttpsServer } from 'https';
import { WebSocketServer, WebSocket } from 'ws';
import { PtyManager } from './pty-manager.js';

import { verifyPassword } from './auth.js';
import { FsManager } from './fs-manager.js';

interface ClientContext {
  ws: WebSocket;
  authenticated: boolean;
  primarySessionId: string | null;
  scope?: string;
  activeSessions: Set<string>;
  lastPing: number;
}

export function setupWebSocketServer(
  httpServer: HttpServer | HttpsServer,
  ptyManager: PtyManager,
  fsManager: FsManager = new FsManager()
): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const clients = new Map<WebSocket, ClientContext>();

  console.log(`[WebSocket] Server initialized on /ws (Auth required)`);

  const broadcastToScope = (scope: string | undefined, msg: object) => {
    const payload = JSON.stringify(msg);
    for (const [clientWs, clientCtx] of clients.entries()) {
      if (clientWs.readyState === WebSocket.OPEN && clientCtx.authenticated) {
        if (scope ? clientCtx.scope === scope : !clientCtx.scope) {
          try {
            clientWs.send(payload);
          } catch {}
        }
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
      scope: undefined,
      activeSessions: new Set<string>(),
      lastPing: Date.now()
    };
    clients.set(ws, ctx);

    ws.on('message', (messageRaw: string | Buffer) => {
      try {
        const text = messageRaw.toString('utf-8');
        const payload = JSON.parse(text);

        switch (payload.type) {
          case 'auth': {
            const { password, sessionId, scope, cols, rows, title } = payload;
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
            const queryScope = req.url ? new URL(req.url, 'http://localhost').searchParams.get('scope') : undefined;
            const effectiveScope = (typeof scope === 'string' && scope.trim().length > 0)
              ? scope.trim()
              : (queryScope && queryScope.trim().length > 0 ? queryScope.trim() : undefined);
            ctx.scope = effectiveScope;

            const targetSessionId = (sessionId && typeof sessionId === 'string' && sessionId.trim().length > 0)
              ? sessionId.trim()
              : `term-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;

            ctx.primarySessionId = targetSessionId;
            ctx.activeSessions.add(targetSessionId);

            const initialCols = cols && Number.isInteger(cols) ? cols : 80;
            const initialRows = rows && Number.isInteger(rows) ? rows : 24;

            const session = ptyManager.getOrCreateSession(targetSessionId, initialCols, initialRows, title, ctx.scope);
            ptyManager.attachClient(targetSessionId, ws);

            console.log(`[WebSocket] Client authenticated for session ${targetSessionId} (scope: ${ctx.scope || 'none'}, title: ${session.title})`);

            ws.send(JSON.stringify({
              type: 'auth_ok',
              sessionId: targetSessionId,
              scope: ctx.scope,
              title: session.title,
              cols: session.cols,
              rows: session.rows,
              sessions: ptyManager.getSessionsForScope(ctx.scope)
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
            const queryScope = (payload.scope && typeof payload.scope === 'string') ? payload.scope.trim() : ctx.scope;
            ws.send(JSON.stringify({
              type: 'session_list',
              sessions: ptyManager.getSessionsForScope(queryScope)
            }));
            break;
          }

          case 'session_create': {
            if (!ctx.authenticated) return;
            const { title, cols, rows } = payload;
            const sessionScope = (payload.scope && typeof payload.scope === 'string' && payload.scope.trim().length > 0)
              ? payload.scope.trim()
              : ctx.scope;
            const newSessionId = `term-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
            const initialCols = cols && Number.isInteger(cols) ? cols : 80;
            const initialRows = rows && Number.isInteger(rows) ? rows : 24;

            const newSession = ptyManager.getOrCreateSession(newSessionId, initialCols, initialRows, title, sessionScope);
            ptyManager.attachClient(newSessionId, ws);
            ctx.activeSessions.add(newSessionId);

            console.log(`[WebSocket] Created new session ${newSessionId} (scope: ${sessionScope || 'none'}, title: ${newSession.title})`);

            ws.send(JSON.stringify({
              type: 'session_created',
              sessionId: newSessionId,
              scope: sessionScope,
              title: newSession.title,
              cols: newSession.cols,
              rows: newSession.rows,
              sessions: ptyManager.getSessionsForScope(sessionScope)
            }));

            // Broadcast updated session list ONLY to clients with the same scope
            broadcastToScope(sessionScope, {
              type: 'session_list_updated',
              sessions: ptyManager.getSessionsForScope(sessionScope)
            });
            break;
          }

          case 'session_attach': {
            if (!ctx.authenticated) return;
            const targetSessionId = payload.sessionId;
            if (!targetSessionId) return;

            const existingSession = ptyManager.getSession(targetSessionId);
            // Isolation check: reject attaching to sessions of another scope
            if (existingSession && ctx.scope && existingSession.scope && existingSession.scope !== ctx.scope) {
              console.warn(`[WebSocket] Attach rejected: session ${targetSessionId} (scope: ${existingSession.scope}) does not match client scope ${ctx.scope}`);
              return;
            }

            const cols = payload.cols && Number.isInteger(payload.cols) ? payload.cols : 80;
            const rows = payload.rows && Number.isInteger(payload.rows) ? payload.rows : 24;

            const session = ptyManager.getOrCreateSession(targetSessionId, cols, rows, undefined, ctx.scope);
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
              const session = ptyManager.getSession(sessionId);
              if (session && ctx.scope && session.scope && session.scope !== ctx.scope) {
                return;
              }
              const targetScope = session?.scope ?? ctx.scope;
              const ok = ptyManager.renameSession(sessionId, title);
              if (ok) {
                broadcastToScope(targetScope, {
                  type: 'session_renamed',
                  sessionId,
                  title,
                  sessions: ptyManager.getSessionsForScope(targetScope)
                });
              }
            }
            break;
          }

          case 'session_kill': {
            if (!ctx.authenticated) return;
            const { sessionId } = payload;
            if (sessionId) {
              const session = ptyManager.getSession(sessionId);
              if (session && ctx.scope && session.scope && session.scope !== ctx.scope) {
                return;
              }
              const targetScope = session?.scope ?? ctx.scope;
              console.log(`[WebSocket] Kill session request for ${sessionId} (scope: ${targetScope || 'none'})`);
              ctx.activeSessions.delete(sessionId);
              ptyManager.destroySession(sessionId);
              broadcastToScope(targetScope, {
                type: 'session_list_updated',
                sessions: ptyManager.getSessionsForScope(targetScope)
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
              const session = ptyManager.getSession(targetSession);
              if (session && ctx.scope && session.scope && session.scope !== ctx.scope) {
                return;
              }
              ptyManager.write(targetSession, payload.data);
            }
            break;
          }

          case 'resize': {
            if (!ctx.authenticated) return;
            const targetSession = payload.sessionId || ctx.primarySessionId;
            const { cols, rows } = payload;
            if (targetSession && cols > 0 && rows > 0) {
              const session = ptyManager.getSession(targetSession);
              if (session && ctx.scope && session.scope && session.scope !== ctx.scope) {
                return;
              }
              ptyManager.resize(targetSession, cols, rows);
            }
            break;
          }

          case 'fs_list': {
            if (!ctx.authenticated) {
              ws.send(JSON.stringify({ type: 'error', error: '未鉴权的会话', reqId: payload.reqId }));
              return;
            }
            try {
              const res = fsManager.listDirectory(payload.path, payload.showHidden ?? true);
              ws.send(JSON.stringify({
                type: 'fs_list_res',
                reqId: payload.reqId,
                ...res
              }));
            } catch (err: any) {
              ws.send(JSON.stringify({
                type: 'fs_list_res',
                reqId: payload.reqId,
                error: err.message || '读取目录失败'
              }));
            }
            break;
          }

          case 'fs_read': {
            if (!ctx.authenticated) {
              ws.send(JSON.stringify({ type: 'error', error: '未鉴权的会话', reqId: payload.reqId }));
              return;
            }
            try {
              const res = fsManager.readFile(payload.path, payload.maxTextBytes);
              ws.send(JSON.stringify({
                type: 'fs_read_res',
                reqId: payload.reqId,
                ...res
              }));
            } catch (err: any) {
              ws.send(JSON.stringify({
                type: 'fs_read_res',
                reqId: payload.reqId,
                error: err.message || '读取文件失败'
              }));
            }
            break;
          }

          case 'fs_action': {
            if (!ctx.authenticated) {
              ws.send(JSON.stringify({ type: 'error', error: '未鉴权的会话', reqId: payload.reqId }));
              return;
            }
            const { action, params, reqId } = payload;
            try {
              let resultData: any = null;
              switch (action) {
                case 'create_file':
                  resultData = fsManager.createFile(params.parentDir, params.name, params.content || '');
                  break;
                case 'create_dir':
                  resultData = fsManager.createDirectory(params.parentDir, params.name);
                  break;
                case 'rename':
                  resultData = fsManager.rename(params.oldPath, params.newName);
                  break;
                case 'delete':
                  if (Array.isArray(params.targetPaths)) {
                    resultData = fsManager.batchDelete(params.targetPaths);
                  } else {
                    fsManager.delete(params.targetPath);
                    resultData = true;
                  }
                  break;
                case 'batch_delete':
                  resultData = fsManager.batchDelete(params.targetPaths || []);
                  break;
                case 'copy':
                  if (Array.isArray(params.sourcePaths)) {
                    resultData = fsManager.batchCopy(params.sourcePaths, params.targetDir);
                  } else {
                    resultData = fsManager.copy(params.sourcePath, params.targetDir);
                  }
                  break;
                case 'write_file':
                  fsManager.writeFile(params.path, params.content);
                  resultData = true;
                  break;
                default:
                  throw new Error(`未知的文件操作: ${action}`);
              }
              ws.send(JSON.stringify({
                type: 'fs_action_res',
                reqId,
                action,
                success: true,
                data: resultData
              }));
            } catch (err: any) {
              ws.send(JSON.stringify({
                type: 'fs_action_res',
                reqId,
                action,
                success: false,
                error: err.message || '操作执行失败'
              }));
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
      clients.delete(ws);
      for (const sid of ctx.activeSessions) {
        ptyManager.detachClient(sid, ws);
      }
      ctx.activeSessions.clear();
    });

    ws.on('error', (err) => {
      clients.delete(ws);
      console.error('[WebSocket] Socket error:', err);
      for (const sid of ctx.activeSessions) {
        ptyManager.detachClient(sid, ws);
      }
      ctx.activeSessions.clear();
    });
  });

  return wss;
}
