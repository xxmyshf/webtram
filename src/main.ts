import { MultiTerminalManager } from './components/MultiTerminalManager.js';
import { SessionTabBar, SessionTabInfo } from './components/SessionTabBar.js';
import { VirtualKeyboard } from './components/VirtualKeyboard.js';
import { StatusBar } from './components/StatusBar.js';
import { AuthModal } from './components/AuthModal.js';
import { PasswordChangeModal } from './components/PasswordChangeModal.js';
import { ASRConfigModal } from './components/ASRConfigModal.js';
import { NativeIMEBridge } from './components/NativeIMEBridge.js';
import { SpeechManager } from './components/SpeechManager.js';
import { FileManager } from './components/FileManager/FileManager.js';
import { hashPassword } from './utils/crypto.js';
import { getTerminalConfig } from './config.js';
import './style.css';

class WebTermApp {
  private multiTerminalManager!: MultiTerminalManager;
  private sessionTabBar!: SessionTabBar;
  private virtualKeyboard!: VirtualKeyboard;
  private statusBar!: StatusBar;
  private authModal!: AuthModal;
  private passwordChangeModal!: PasswordChangeModal;
  private asrConfigModal!: ASRConfigModal;
  private nativeIMEBridge!: NativeIMEBridge;
  private speechManager!: SpeechManager;
  private fileManager!: FileManager;
  private termWrapper!: HTMLElement;
  private currentView: 'terminal' | 'files' = 'terminal';

  private ws: WebSocket | null = null;
  private activeSessionId: string | null = null;
  private scope = '';
  private ownedSessionIds: Set<string> = new Set();
  private attachedSessionIds: Set<string> = new Set();
  private cachedPassword = '';
  private isConnecting = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private pingInterval: NodeJS.Timeout | null = null;
  private pingStartTs = 0;
  private startupCmd = '';
  private isRestore = false;
  private startupCmdExecuted = false;

  constructor() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlSessionId = urlParams.get('sessionId') || urlParams.get('session');
    const config = getTerminalConfig();
    this.scope = urlParams.get('scope') || urlParams.get('conversationId') || urlParams.get('convId') || config.scope || config.conversationId || '';
    this.startupCmd = urlParams.get('cmd') || urlParams.get('run') || '';
    this.isRestore = urlParams.get('restore') === 'true' || urlParams.get('restore') === '1';

    const sessionStoreKey = this.scope ? `webterm_session_id_${this.scope}` : 'webterm_session_id';
    if (urlSessionId) {
      this.activeSessionId = urlSessionId;
    } else {
      this.activeSessionId = localStorage.getItem(sessionStoreKey);
    }
    if (this.activeSessionId) {
      this.ownedSessionIds.add(this.activeSessionId);
    }
    this.cachedPassword = localStorage.getItem('webterm_pwd') || sessionStorage.getItem('webterm_pwd') || '';
  }

  public init(): void {
    let appEl = document.getElementById('app');
    if (!appEl) {
      appEl = document.createElement('div');
      appEl.id = 'app';
      document.body.appendChild(appEl);
    }

    // 1. Speech Manager
    this.speechManager = new SpeechManager();

    // 2. Status Bar (Must be appended FIRST to stay on TOP)
    this.statusBar = new StatusBar({
      onToggleKeyboard: () => this.virtualKeyboard.toggleCollapse(),
      onReconnect: () => this.reconnect(),
      onOpenPasswordModal: () => this.passwordChangeModal.show(),
      onOpenASRModal: () => this.asrConfigModal.show(),
      onToggleNativeIME: () => this.nativeIMEBridge.toggle(),
      onGetFontSize: () => this.multiTerminalManager.getFontSize(),
      onSetFontSize: (size) => this.multiTerminalManager.setFontSize(size),
      onSwitchView: (view) => this.switchView(view)
    });
    appEl.appendChild(this.statusBar.getElement());

    // 3. Session Tab Bar (embedded in StatusBar center)
    this.sessionTabBar = new SessionTabBar({
      onSelectSession: (id) => {
        this.selectSession(id);
        if (this.currentView === 'files') {
          this.switchView('terminal');
        }
      },
      onCreateSession: () => {
        this.createSession();
        if (this.currentView === 'files') {
          this.switchView('terminal');
        }
      },
      onCloseSession: (id) => this.closeSession(id),
      onRenameSession: (id, newTitle) => this.renameSession(id, newTitle)
    });
    this.statusBar.setTabBar(this.sessionTabBar.getElement());

    // 4. Terminal Container (MIDDLE)
    this.termWrapper = document.createElement('div');
    this.termWrapper.className = 'terminal-wrapper';
    this.termWrapper.addEventListener('pointerdown', () => {
      if (this.currentView === 'terminal') {
        this.multiTerminalManager.focus();
      }
    });
    appEl.appendChild(this.termWrapper);

    this.multiTerminalManager = new MultiTerminalManager({
      container: this.termWrapper,
      onInput: (sessionId, data) => this.sendInput(data, sessionId),
      onResize: (sessionId, cols, rows) => this.sendResize(sessionId, cols, rows),
      onUnread: (sessionId) => this.sessionTabBar.setUnread(sessionId, true)
    });

    // 5. File Manager (Coexists with terminal, toggled by view switch)
    this.fileManager = new FileManager({
      sendWsMessage: (msg) => this.sendWsJson(msg),
      getAuthPassword: () => this.cachedPassword,
      getScope: () => this.scope,
      onOpenInTerminal: (dirPath) => {
        this.sendInput(`cd "${dirPath}"\n`);
        this.switchView('terminal');
      },
      onSwitchToTerminal: () => this.switchView('terminal')
    });
    appEl.appendChild(this.fileManager.getElement());
    this.fileManager.hide();
    // 5. Virtual Keyboard (BOTTOM - in flex flow so it never overlaps terminal)
    this.virtualKeyboard = new VirtualKeyboard({
      onInput: (data) => this.sendInput(data),
      onResizeTrigger: () => this.multiTerminalManager.fit(),
      onToggleNativeIME: () => this.nativeIMEBridge.toggle(),
      onScrollTerminal: (deltaY) => this.multiTerminalManager.scrollByDeltaY(deltaY),
      speechManager: this.speechManager
    });
    appEl.appendChild(this.virtualKeyboard.getElement());

    // 6. Native IME Bridge (hides virtual keyboard when opened, restores when closed)
    this.nativeIMEBridge = new NativeIMEBridge({
      onInput: (data) => this.sendInput(data),
      onActivate: () => {
        this.virtualKeyboard.hide();
        setTimeout(() => this.multiTerminalManager.fit(), 100);
      },
      onDeactivate: () => {
        this.virtualKeyboard.show();
        setTimeout(() => this.multiTerminalManager.fit(), 100);
      }
    });

    // 7. Modals
    this.authModal = new AuthModal({
      onSubmit: async (pwd) => {
        return this.tryAuthenticate(pwd);
      }
    });

    this.passwordChangeModal = new PasswordChangeModal({
      onSuccess: async (newPwd) => {
        const hash = await hashPassword(newPwd);
        this.cachedPassword = hash;
        localStorage.setItem('webterm_pwd', hash);
        sessionStorage.setItem('webterm_pwd', hash);
      }
    });

    this.asrConfigModal = new ASRConfigModal(this.speechManager);

    // Enable Keyboard Lock API so Chromium/Edge delivers physical Escape to the web app in fullscreen
    const requestEscapeLock = () => {
      if ('keyboard' in navigator && typeof (navigator as any).keyboard?.lock === 'function') {
        (navigator as any).keyboard.lock(['Escape']).catch(() => {});
      }
    };
    const releaseEscapeLock = () => {
      if ('keyboard' in navigator && typeof (navigator as any).keyboard?.unlock === 'function') {
        (navigator as any).keyboard.unlock();
      }
    };

    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement) {
        requestEscapeLock();
      } else {
        releaseEscapeLock();
      }
    });

    // Global hotkey & physical Escape capture (captures on window in CAPTURE phase)
    let escHandledOnKeyDown = false;

    const handleEscapeKey = (e: KeyboardEvent) => {
      if (this.currentView !== 'terminal') return;

      // Do not intercept if an interactive modal dialog is open
      const hasOpenModal = document.querySelector('.cyber-modal-overlay.modal-overlay-show, .cyber-auth-overlay:not(.hidden)');
      const target = e.target as HTMLElement;
      const tag = (target?.tagName || '').toLowerCase();
      const isTerminalTextarea = target?.classList.contains('xterm-helper-textarea') || target?.classList.contains('native-ime-hidden-input');
      // Only protect genuinely visible text inputs being actively edited (e.g. tab rename input)
      const isVisibleInput = (tag === 'input' || (tag === 'textarea' && !isTerminalTextarea)) && target?.offsetParent !== null;

      if (!hasOpenModal && !isVisibleInput) {
        e.preventDefault();
        e.stopPropagation();
        const activeSid = this.multiTerminalManager.getActiveSessionId() || this.activeSessionId;
        this.sendInput(e.altKey ? '\x1b\x1b' : '\x1b', activeSid || undefined);
        this.multiTerminalManager.focus();
      }
    };

    window.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'f' || e.key === 'F' || e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        this.switchView(this.currentView === 'terminal' ? 'files' : 'terminal');
        return;
      }

      if (e.key === 'Escape' || e.code === 'Escape' || e.keyCode === 27) {
        escHandledOnKeyDown = true;
        handleEscapeKey(e);
      }
    }, { capture: true });

    window.addEventListener('keyup', (e) => {
      if (e.key === 'Escape' || e.code === 'Escape' || e.keyCode === 27) {
        if (!escHandledOnKeyDown) {
          handleEscapeKey(e);
        }
        escHandledOnKeyDown = false;
      }
    }, { capture: true });

    // Setup postMessage communication with parent host (WebTerm Manager)
    window.addEventListener('message', (event) => {
      if (!event.data || typeof event.data !== 'object') return;
      const { type, cmd, sessionId } = event.data;
      if (type === 'RUN_COMMAND' && typeof cmd === 'string') {
        const toSend = cmd.endsWith('\n') || cmd.endsWith('\r') ? cmd : cmd + '\r';
        this.sendInput(toSend, sessionId);
      } else if (type === 'FOCUS') {
        this.multiTerminalManager.focus();
      } else if (type === 'FIT') {
        this.multiTerminalManager.fit();
      }
    });

    const config = getTerminalConfig();
    const urlParams = new URLSearchParams(window.location.search);
    const paramPwd = urlParams.get('pwd') || urlParams.get('password') || config.defaultPassword;

    const proceedAuth = () => {
      if (!this.cachedPassword) {
        this.authModal.show();
      } else {
        this.connectWebSocket();
      }
    };

    if (paramPwd) {
      if (paramPwd.length === 64 && /^[0-9a-fA-F]+$/.test(paramPwd)) {
        this.cachedPassword = paramPwd.toLowerCase();
        localStorage.setItem('webterm_pwd', this.cachedPassword);
        proceedAuth();
      } else {
        hashPassword(paramPwd).then((hash) => {
          this.cachedPassword = hash;
          localStorage.setItem('webterm_pwd', hash);
          proceedAuth();
        }).catch(() => proceedAuth());
      }
    } else {
      proceedAuth();
    }
  }

  private lastInputTime = 0;
  private lastInputData = '';

  private sendInput(data: string, targetSessionId?: string): void {
    const now = Date.now();
    // Guard against identical duplicate input within 40ms (never drop Escape \x1b)
    const isEsc = data === '\x1b' || data === '\x1b\x1b';
    if (!isEsc && data === this.lastInputData && now - this.lastInputTime < 40) {
      return;
    }
    this.lastInputTime = now;
    this.lastInputData = data;

    const sid = targetSessionId || this.multiTerminalManager?.getActiveSessionId() || this.activeSessionId;
    if (this.ws && this.ws.readyState === WebSocket.OPEN && sid) {
      this.ws.send(JSON.stringify({
        type: 'input',
        sessionId: sid,
        data
      }));
    }
  }

  private sendResize(sessionId: string, cols: number, rows: number): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'resize',
        sessionId,
        cols,
        rows
      }));
    }
  }

  private createSession(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const curTabs = this.sessionTabBar.getTabs();
      const title = `term-${curTabs.length + 1}`;
      this.ws.send(JSON.stringify({
        type: 'session_create',
        title,
        scope: this.scope || undefined,
        cols: this.multiTerminalManager.getCols(),
        rows: this.multiTerminalManager.getRows()
      }));
    }
  }

  private closeSession(sessionId: string): void {
    const tabs = this.sessionTabBar.getTabs();
    if (tabs.length <= 1) {
      const confirmed = window.confirm('当前仅剩一个终端，关闭将重置并新建终端，是否继续？');
      if (!confirmed) return;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'session_kill', sessionId }));
        this.createSession();
      }
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'session_kill',
        sessionId
      }));
    }
    this.handleSessionClosed(sessionId);
  }

  private handleSessionClosed(sessionId: string): void {
    this.ownedSessionIds.delete(sessionId);
    this.attachedSessionIds.delete(sessionId);
    this.multiTerminalManager.removeTerminal(sessionId);
    const tabs = this.sessionTabBar.getTabs().filter(t => t.id !== sessionId);

    let nextActive = this.activeSessionId;
    if (nextActive === sessionId) {
      nextActive = tabs.length > 0 ? tabs[tabs.length - 1].id : null;
    }

    this.sessionTabBar.setTabs(tabs.map(t => ({
      ...t,
      active: t.id === nextActive
    })));

    if (nextActive) {
      this.selectSession(nextActive);
    }
  }

  private renameSession(sessionId: string, newTitle: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'session_rename',
        sessionId,
        title: newTitle
      }));
    }
  }

  private updateSessionsList(sessions: Array<{ id: string; title: string; scope?: string }>, preferredActiveId?: string): void {
    if (!sessions || sessions.length === 0) return;

    // Defensively isolate by scope if current app instance is scoped
    const filteredSessions = this.scope
      ? sessions.filter(s => s.scope === this.scope || this.ownedSessionIds.has(s.id))
      : sessions;

    const effectiveSessions = filteredSessions.length > 0
      ? filteredSessions
      : (this.activeSessionId ? [{ id: this.activeSessionId, title: 'Terminal 1', scope: this.scope || undefined }] : []);

    if (effectiveSessions.length === 0) return;

    for (const s of effectiveSessions) {
      this.ownedSessionIds.add(s.id);
    }

    let targetActiveId = preferredActiveId || this.activeSessionId;
    // Check if targetActiveId actually exists in sessions
    if (!targetActiveId || !effectiveSessions.some(s => s.id === targetActiveId)) {
      targetActiveId = effectiveSessions[0].id;
    }

    this.activeSessionId = targetActiveId;
    this.ownedSessionIds.add(targetActiveId);
    const sessionStoreKey = this.scope ? `webterm_session_id_${this.scope}` : 'webterm_session_id';
    localStorage.setItem(sessionStoreKey, targetActiveId);

    const curTabs = this.sessionTabBar.getTabs();
    const newTabs: SessionTabInfo[] = effectiveSessions.map(s => {
      const existing = curTabs.find(t => t.id === s.id);
      return {
        id: s.id,
        title: s.title,
        active: s.id === targetActiveId,
        hasUnread: existing ? existing.hasUnread : false
      };
    });

    this.sessionTabBar.setTabs(newTabs);

    for (const s of effectiveSessions) {
      this.multiTerminalManager.getOrCreateTerminal(s.id);
    }

    this.multiTerminalManager.switchSession(targetActiveId);
  }

  private selectSession(sessionId: string): void {
    this.activeSessionId = sessionId;
    const sessionStoreKey = this.scope ? `webterm_session_id_${this.scope}` : 'webterm_session_id';
    localStorage.setItem(sessionStoreKey, sessionId);
    this.multiTerminalManager.getOrCreateTerminal(sessionId);
    this.multiTerminalManager.switchSession(sessionId);
    this.sessionTabBar.setActiveTab(sessionId);

    // Only send session_attach if not yet attached on WebSocket
    if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.attachedSessionIds.has(sessionId)) {
      this.attachedSessionIds.add(sessionId);
      this.ws.send(JSON.stringify({
        type: 'session_attach',
        sessionId,
        cols: this.multiTerminalManager.getCols(),
        rows: this.multiTerminalManager.getRows()
      }));
    }
  }

  private async tryAuthenticate(password: string): Promise<boolean> {
    const hash = await hashPassword(password);
    this.cachedPassword = hash;

    return new Promise((resolve) => {
      this.connectWebSocket((ok) => {
        if (ok) {
          localStorage.setItem('webterm_pwd', hash);
          sessionStorage.setItem('webterm_pwd', hash);
          resolve(true);
        } else {
          this.cachedPassword = '';
          localStorage.removeItem('webterm_pwd');
          sessionStorage.removeItem('webterm_pwd');
          resolve(false);
        }
      });
    });
  }

  private connectWebSocket(onAuthResult?: (success: boolean) => void): void {
    if (this.isConnecting) return;
    this.isConnecting = true;
    this.attachedSessionIds.clear();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      const oldWs = this.ws;
      this.ws = null;
      try {
        oldWs.onopen = null;
        oldWs.onmessage = null;
        oldWs.onclose = null;
        oldWs.onerror = null;
        oldWs.close();
      } catch {}
    }

    this.statusBar.setConnectionState('reconnecting');

    const config = getTerminalConfig();

    try {
      this.ws = new WebSocket(config.wsUrl!);
    } catch (err) {
      console.error('[App] Failed to construct WebSocket:', err);
      this.statusBar.setConnectionState('offline');
      this.isConnecting = false;
      onAuthResult?.(false);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.ws!.send(JSON.stringify({
        type: 'auth',
        password: this.cachedPassword,
        sessionId: this.activeSessionId,
        scope: this.scope || undefined,
        cols: this.multiTerminalManager.getCols() || 80,
        rows: this.multiTerminalManager.getRows() || 24
      }));
    };

    this.ws.onmessage = async (event) => {
      try {
        let rawData: string;
        if (typeof event.data === 'string') {
          rawData = event.data;
        } else if (event.data instanceof Blob) {
          rawData = await event.data.text();
        } else if (event.data instanceof ArrayBuffer) {
          rawData = new TextDecoder().decode(event.data);
        } else {
          rawData = String(event.data);
        }

        const msg = JSON.parse(rawData);

        // Forward file system messages to fileManager
        if (this.fileManager && this.fileManager.handleWsMessage(msg)) {
          return;
        }

        switch (msg.type) {
          case 'auth_ok': {
            this.isConnecting = false;
            this.reconnectAttempts = 0;
            this.statusBar.setConnectionState('online');
            this.authModal.hide();
            if (this.currentView === 'files') {
              this.fileManager.refreshCurrentDir();
            }
            this.startPingInterval();
            onAuthResult?.(true);

            if (msg.sessionId) {
              this.ownedSessionIds.add(msg.sessionId);
            }

            const rawSessions = Array.isArray(msg.sessions) && msg.sessions.length > 0
              ? msg.sessions
              : [{ id: msg.sessionId, title: msg.title || 'Terminal 1', scope: this.scope || undefined }];

            const serverSessions = this.scope
              ? rawSessions.filter((s: any) => s && (s.scope === this.scope || this.ownedSessionIds.has(s.id)))
              : rawSessions;

            const finalSessions = serverSessions.length > 0
              ? serverSessions
              : [{ id: msg.sessionId, title: msg.title || 'Terminal 1', scope: this.scope || undefined }];

            for (const s of finalSessions) {
              if (s && s.id) this.ownedSessionIds.add(s.id);
            }

            this.updateSessionsList(finalSessions, msg.sessionId);

            if (msg.sessionId) {
              this.attachedSessionIds.add(msg.sessionId);
            }

            // Re-attach to all other sessions in this scope so background outputs stream in real-time
            for (const s of finalSessions) {
              if (s.id !== msg.sessionId && this.ws && this.ws.readyState === WebSocket.OPEN && !this.attachedSessionIds.has(s.id)) {
                this.attachedSessionIds.add(s.id);
                this.ws.send(JSON.stringify({
                  type: 'session_attach',
                  sessionId: s.id,
                  cols: this.multiTerminalManager.getCols(),
                  rows: this.multiTerminalManager.getRows()
                }));
              }
            }

            const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
            if (!isTouch) {
              this.multiTerminalManager.focus();
            }

            // Notify parent WebTerm Manager
            try {
              window.parent.postMessage({
                type: 'WEBTERM_READY',
                sessionId: msg.sessionId,
                isRestore: this.isRestore
              }, '*');
            } catch {}

            // Execute startup command if fresh conversation
            if (this.startupCmd && !this.isRestore && !this.startupCmdExecuted) {
              this.startupCmdExecuted = true;
              setTimeout(() => {
                const cmdToSend = this.startupCmd.endsWith('\n') || this.startupCmd.endsWith('\r')
                  ? this.startupCmd
                  : this.startupCmd + '\r';
                this.sendInput(cmdToSend, msg.sessionId);
                try {
                  window.parent.postMessage({
                    type: 'WEBTERM_STARTUP_EXECUTED',
                    sessionId: msg.sessionId
                  }, '*');
                } catch {}
              }, 350);
            }
            break;
          }

          case 'session_list': {
            if (Array.isArray(msg.sessions)) {
              this.updateSessionsList(msg.sessions, this.activeSessionId || undefined);
            }
            break;
          }

          case 'session_created': {
            if (msg.sessionId) {
              this.ownedSessionIds.add(msg.sessionId);
              this.attachedSessionIds.add(msg.sessionId);
            }
            if (Array.isArray(msg.sessions)) {
              this.updateSessionsList(msg.sessions, msg.sessionId);
            } else {
              this.multiTerminalManager.getOrCreateTerminal(msg.sessionId);
              this.selectSession(msg.sessionId);
            }
            break;
          }

          case 'session_list_updated': {
            if (Array.isArray(msg.sessions)) {
              this.updateSessionsList(msg.sessions, this.activeSessionId || undefined);
            }
            break;
          }

          case 'session_renamed': {
            if (msg.sessionId && msg.title) {
              this.sessionTabBar.updateTab(msg.sessionId, { title: msg.title });
            }
            break;
          }

          case 'session_closed': {
            if (msg.sessionId) {
              this.handleSessionClosed(msg.sessionId);
            }
            break;
          }

          case 'history': {
            const sid = msg.sessionId || this.activeSessionId;
            if (sid) {
              if (this.scope && !this.ownedSessionIds.has(sid)) {
                break;
              }
              const term = this.multiTerminalManager.getOrCreateTerminal(sid);
              term.clear();
              this.multiTerminalManager.writeHistory(sid, msg.data);
            }
            break;
          }

          case 'output': {
            const sid = msg.sessionId || this.activeSessionId;
            if (sid) {
              if (this.scope && !this.ownedSessionIds.has(sid)) {
                break;
              }
              this.multiTerminalManager.write(sid, msg.data);
            }
            break;
          }

          case 'exit': {
            const sid = msg.sessionId || this.activeSessionId;
            if (sid) {
              this.multiTerminalManager.write(sid, '\r\n\x1b[33m[Session process terminated]\x1b[0m\r\n');
            }
            break;
          }

          case 'error': {
            this.isConnecting = false;
            if (this.reconnectTimer) {
              clearTimeout(this.reconnectTimer);
              this.reconnectTimer = null;
            }
            this.statusBar.setConnectionState('offline');
            const errDetail = msg.error || '目标服务连接异常';
            const curTerm = this.multiTerminalManager.getActiveTerminal();
            curTerm?.write(`\r\n\x1b[31m[Connection Error] ${errDetail}\x1b[0m\r\n`);
            break;
          }

          case 'auth_fail': {
            this.isConnecting = false;
            this.cachedPassword = '';
            this.reconnectAttempts = 0;
            localStorage.removeItem('webterm_pwd');
            sessionStorage.removeItem('webterm_pwd');
            if (this.reconnectTimer) {
              clearTimeout(this.reconnectTimer);
              this.reconnectTimer = null;
            }
            this.statusBar.setConnectionState('offline');
            const curTerm = this.multiTerminalManager.getActiveTerminal();
            curTerm?.write(`\r\n\x1b[31m[Auth Failed] ${msg.error || '节点访问密码不匹配'}\x1b[0m\r\n`);

            if (onAuthResult) {
              onAuthResult(false);
            } else {
              this.authModal.show(true);
              this.authModal.showError(msg.error || '认证失败，请重新输入密码');
            }

            if (this.ws) {
              const oldWs = this.ws;
              this.ws = null;
              try {
                oldWs.onopen = null;
                oldWs.onmessage = null;
                oldWs.onclose = null;
                oldWs.onerror = null;
                oldWs.close();
              } catch {}
            }
            break;
          }

          case 'pong': {
            const rtt = Date.now() - this.pingStartTs;
            this.statusBar.setPing(rtt);
            break;
          }
        }
      } catch (err) {
        console.error('[App] Error processing message:', err);
      }
    };

    this.ws.onclose = () => {
      this.isConnecting = false;
      this.stopPingInterval();
      this.statusBar.setConnectionState('offline');
      this.scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.error('[App] WebSocket error:', err);
      this.isConnecting = false;
      this.statusBar.setConnectionState('offline');
    };
  }

  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.pingStartTs = Date.now();
        this.ws.send(JSON.stringify({ type: 'ping', ts: this.pingStartTs }));
      }
    }, 4000);
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.cachedPassword) return;
    if (this.reconnectAttempts >= 10) {
      this.statusBar.setConnectionState('offline');
      const curTerm = this.multiTerminalManager.getActiveTerminal();
      curTerm?.write('\r\n\x1b[33m[WebTerm] 连续重连失败达到上限，已暂停自动重试。请检查目标节点服务状态或手动点击右上角重连。\x1b[0m\r\n');
      return;
    }
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWebSocket();
    }, 3000);
  }

  public switchView(view: 'terminal' | 'files'): void {
    if (this.currentView === view) return;
    this.currentView = view;
    this.statusBar.setActiveView(view);

    if (view === 'files') {
      this.termWrapper.style.display = 'none';
      this.virtualKeyboard.hide();
      this.fileManager.show();
    } else {
      this.fileManager.hide();
      this.termWrapper.style.display = 'flex';
      this.virtualKeyboard.show();
      setTimeout(() => {
        this.multiTerminalManager.fit();
        const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        if (!isTouch) {
          this.multiTerminalManager.focus();
        }
      }, 50);
    }
  }

  public sendWsJson(msg: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private reconnect(): void {
    this.reconnectAttempts = 0;
    if (!this.cachedPassword) {
      this.authModal.show();
      return;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
    }
    this.connectWebSocket();
  }
}

// Bootstrap
function startWebTerm(): void {
  const app = new WebTermApp();
  app.init();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', startWebTerm);
} else {
  startWebTerm();
}
