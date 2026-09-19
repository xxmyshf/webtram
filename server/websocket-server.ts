import { Server as HttpServer } from 'http';
import { Server as HttpsServer } from 'https';
import { WebSocketServer, WebSocket } from 'ws';
import { PtyManager } from './pty-manager.js';

import { verifyPassword } from './auth.js';
import { FsManager } from './fs-manager.js';

interface ClientContext {
  ws: WebSocket;
  authenticated: boolean;
  sessionId: string | null;
  lastPing: number;
}

export function setupWebSocketServer(
  httpServer: HttpServer | HttpsServer,
  ptyManager: PtyManager,
  fsManager: FsManager = new FsManager()
): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  console.log(`[WebSocket] Server initialized on /ws (Auth required)`);

  wss.on('connection', (ws: WebSocket, req) => {
    const ip = req.socket.remoteAddress || 'unknown';
    console.log(`[WebSocket] New incoming connection from ${ip}`);

    const ctx: ClientContext = {
      ws,
      authenticated: false,
      sessionId: null,
      lastPing: Date.now()
    };

    ws.on('message', (messageRaw: string | Buffer) => {
      try {
        const text = messageRaw.toString('utf-8');
        const payload = JSON.parse(text);

        switch (payload.type) {
          case 'auth': {
            const { password, sessionId, cols, rows } = payload;
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

            ctx.sessionId = targetSessionId;

            const initialCols = cols && Number.isInteger(cols) ? cols : 80;
            const initialRows = rows && Number.isInteger(rows) ? rows : 24;

            const session = ptyManager.getOrCreateSession(targetSessionId, initialCols, initialRows);
            ptyManager.attachClient(targetSessionId, ws);

            console.log(`[WebSocket] Client authenticated for session ${targetSessionId}`);

            ws.send(JSON.stringify({
              type: 'auth_ok',
              sessionId: targetSessionId,
              cols: session.cols,
              rows: session.rows
            }));

            // Replay history if existing
            const history = session.ringBuffer.getReplayData();
            if (history) {
              ws.send(JSON.stringify({
                type: 'history',
                data: history
              }));
            }
            break;
          }

          case 'input': {
            if (!ctx.authenticated || !ctx.sessionId) {
              ws.send(JSON.stringify({ type: 'error', error: 'Unauthenticated session' }));
              return;
            }
            if (typeof payload.data === 'string') {
              ptyManager.write(ctx.sessionId, payload.data);
            }
            break;
          }

          case 'resize': {
            if (!ctx.authenticated || !ctx.sessionId) return;
            const { cols, rows } = payload;
            if (cols > 0 && rows > 0) {
              ptyManager.resize(ctx.sessionId, cols, rows);
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
      if (ctx.sessionId) {
        ptyManager.detachClient(ctx.sessionId, ws);
      }
    });

    ws.on('error', (err) => {
      console.error('[WebSocket] Socket error:', err);
      if (ctx.sessionId) {
        ptyManager.detachClient(ctx.sessionId, ws);
      }
    });
  });

  return wss;
}
