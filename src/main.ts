import { TerminalManager } from './components/TerminalManager.js';
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
  private terminalManager!: TerminalManager;
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
  private sessionId: string | null = null;
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
    this.startupCmd = urlParams.get('cmd') || urlParams.get('run') || '';
    this.isRestore = urlParams.get('restore') === 'true' || urlParams.get('restore') === '1';

    if (urlSessionId) {
      this.sessionId = urlSessionId;
    } else {
      this.sessionId = localStorage.getItem('webterm_session_id');
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
      onGetFontSize: () => this.terminalManager.getFontSize(),
      onSetFontSize: (size) => this.terminalManager.setFontSize(size),
      onSwitchView: (view) => this.switchView(view)
    });
    appEl.appendChild(this.statusBar.getElement());

    // 3. Terminal Container (MIDDLE)
    this.termWrapper = document.createElement('div');
    this.termWrapper.className = 'terminal-wrapper';
    appEl.appendChild(this.termWrapper);

    this.terminalManager = new TerminalManager({
      container: this.termWrapper,
      onInput: (data) => this.sendInput(data),
      onResize: (cols, rows) => this.sendResize(cols, rows)
    });

    // 4. File Manager (Coexists with terminal, toggled by view switch)
    this.fileManager = new FileManager({
      sendWsMessage: (msg) => this.sendWsJson(msg),
      getAuthPassword: () => this.cachedPassword,
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
      onResizeTrigger: () => this.terminalManager.fit(),
      onToggleNativeIME: () => this.nativeIMEBridge.toggle(),
      onScrollTerminal: (deltaY) => this.terminalManager.scrollByDeltaY(deltaY),
      speechManager: this.speechManager
    });
    appEl.appendChild(this.virtualKeyboard.getElement());

    // 6. Native IME Bridge (hides virtual keyboard when opened, restores when closed)
    this.nativeIMEBridge = new NativeIMEBridge({
      onInput: (data) => this.sendInput(data),
      onActivate: () => {
        this.virtualKeyboard.hide();
        setTimeout(() => this.terminalManager.fit(), 100);
      },
      onDeactivate: () => {
        this.virtualKeyboard.show();
        setTimeout(() => this.terminalManager.fit(), 100);
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

    // Global hotkey: Alt+F or Alt+E to toggle between Terminal and Files
    window.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'f' || e.key === 'F' || e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        this.switchView(this.currentView === 'terminal' ? 'files' : 'terminal');
      }
    });

    // Setup postMessage communication with parent host (WebTerm Manager)
    window.addEventListener('message', (event) => {
      if (!event.data || typeof event.data !== 'object') return;
      const { type, cmd, sessionId } = event.data;
      if (type === 'RUN_COMMAND' && typeof cmd === 'string') {
        const toSend = cmd.endsWith('\n') || cmd.endsWith('\r') ? cmd : cmd + '\r';
        this.sendInput(toSend);
      } else if (type === 'FOCUS') {
        this.terminalManager.focus();
      } else if (type === 'FIT') {
        this.terminalManager.fit();
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

  private sendInput(data: string): void {
    const now = Date.now();
    // Guard against identical duplicate input within 60ms
    if (data === this.lastInputData && now - this.lastInputTime < 60) {
      return;
    }
    this.lastInputTime = now;
    this.lastInputData = data;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'input',
        data
      }));
    }
  }

  private sendResize(cols: number, rows: number): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'resize',
        cols,
        rows
      }));
    }
  }

  private async tryAuthenticate(password: string): Promise<boolean> {
    // Encrypt password on frontend with SHA-256 before transmission
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

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Clean up any existing connection before opening a new one
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
      // Send hashed password over WebSocket
      this.ws!.send(JSON.stringify({
        type: 'auth',
        password: this.cachedPassword,
        sessionId: this.sessionId,
        cols: this.terminalManager.getCols() || 80,
        rows: this.terminalManager.getRows() || 24
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
            this.sessionId = msg.sessionId;
            localStorage.setItem('webterm_session_id', msg.sessionId);
            this.statusBar.setSessionId(msg.sessionId);
            this.statusBar.setConnectionState('online');
            this.authModal.hide();

            if (this.currentView === 'files') {
              this.fileManager.refreshCurrentDir();
            }

            // Only auto-focus on non-touch desktop to avoid popping up mobile OS keyboard
            const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
            if (!isTouch) {
              this.terminalManager.focus();
            }
            this.startPingInterval();
            onAuthResult?.(true);

            // Notify parent WebTerm Manager
            try {
              window.parent.postMessage({
                type: 'WEBTERM_READY',
                sessionId: msg.sessionId,
                isRestore: this.isRestore
              }, '*');
            } catch {}

            // Execute startup command if this is a fresh conversation (not a restored conversation)
            if (this.startupCmd && !this.isRestore && !this.startupCmdExecuted) {
              this.startupCmdExecuted = true;
              setTimeout(() => {
                const cmdToSend = this.startupCmd.endsWith('\n') || this.startupCmd.endsWith('\r')
                  ? this.startupCmd
                  : this.startupCmd + '\r';
                this.sendInput(cmdToSend);
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

          case 'error': {
            this.isConnecting = false;
            if (this.reconnectTimer) {
              clearTimeout(this.reconnectTimer);
              this.reconnectTimer = null;
            }
            this.statusBar.setConnectionState('offline');
            const errDetail = msg.error || '目标服务连接异常';
            this.terminalManager.write(`\r\n\x1b[31m[Connection Error] ${errDetail}\x1b[0m\r\n`);
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
            this.terminalManager.write(`\r\n\x1b[31m[Auth Failed] ${msg.error || '节点访问密码不匹配'}\x1b[0m\r\n`);

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

          case 'history': {
            this.terminalManager.clear();
            this.terminalManager.write(msg.data);
            break;
          }

          case 'output': {
            this.terminalManager.write(msg.data);
            break;
          }

          case 'pong': {
            const rtt = Date.now() - this.pingStartTs;
            this.statusBar.setPing(rtt);
            break;
          }

          case 'exit': {
            this.terminalManager.write('\r\n\x1b[33m[Session process terminated]\x1b[0m\r\n');
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
    if (this.reconnectAttempts >= 5) {
      this.statusBar.setConnectionState('offline');
      this.terminalManager.write('\r\n\x1b[33m[WebTerm] 连续重连失败达到上限 (5次)，已停止重试。请检查目标节点服务状态或手动点击右上角重连。\x1b[0m\r\n');
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
      setTimeout(() => this.terminalManager.fit(), 50);
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
