import { TerminalManager } from './components/TerminalManager.js';
import { VirtualKeyboard } from './components/VirtualKeyboard.js';
import { StatusBar } from './components/StatusBar.js';
import { AuthModal } from './components/AuthModal.js';
import { PasswordChangeModal } from './components/PasswordChangeModal.js';
import { ASRConfigModal } from './components/ASRConfigModal.js';
import { NativeIMEBridge } from './components/NativeIMEBridge.js';
import { SpeechManager } from './components/SpeechManager.js';
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

  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private cachedPassword = '';
  private isConnecting = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private pingStartTs = 0;

  constructor() {
    this.sessionId = localStorage.getItem('webterm_session_id');
    this.cachedPassword = sessionStorage.getItem('webterm_pwd') || '';
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
      onSetFontSize: (size) => this.terminalManager.setFontSize(size)
    });
    appEl.appendChild(this.statusBar.getElement());

    // 3. Terminal Container (MIDDLE)
    const termWrapper = document.createElement('div');
    termWrapper.className = 'terminal-wrapper';
    appEl.appendChild(termWrapper);

    this.terminalManager = new TerminalManager({
      container: termWrapper,
      onInput: (data) => this.sendInput(data),
      onResize: (cols, rows) => this.sendResize(cols, rows)
    });

    // 4. Virtual Keyboard (BOTTOM - in flex flow so it never overlaps terminal)
    this.virtualKeyboard = new VirtualKeyboard({
      onInput: (data) => this.sendInput(data),
      onResizeTrigger: () => this.terminalManager.fit(),
      onToggleNativeIME: () => this.nativeIMEBridge.toggle(),
      onScrollTerminal: (deltaY) => this.terminalManager.scrollByDeltaY(deltaY),
      speechManager: this.speechManager
    });
    appEl.appendChild(this.virtualKeyboard.getElement());

    // 5. Native IME Bridge (hides virtual keyboard when opened, restores when closed)
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

    // 6. Modals
    this.authModal = new AuthModal({
      onSubmit: async (pwd) => {
        return this.tryAuthenticate(pwd);
      }
    });

    this.passwordChangeModal = new PasswordChangeModal({
      onSuccess: async (newPwd) => {
        const hash = await hashPassword(newPwd);
        this.cachedPassword = hash;
        sessionStorage.setItem('webterm_pwd', hash);
      }
    });

    this.asrConfigModal = new ASRConfigModal(this.speechManager);

    // Initial check
    if (!this.cachedPassword) {
      this.authModal.show();
    } else {
      this.connectWebSocket();
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
          sessionStorage.setItem('webterm_pwd', hash);
          resolve(true);
        } else {
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

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'auth_ok': {
            this.isConnecting = false;
            this.sessionId = msg.sessionId;
            localStorage.setItem('webterm_session_id', msg.sessionId);
            this.statusBar.setSessionId(msg.sessionId);
            this.statusBar.setConnectionState('online');
            // Only auto-focus on non-touch desktop to avoid popping up mobile OS keyboard
            const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
            if (!isTouch) {
              this.terminalManager.focus();
            }
            this.startPingInterval();
            onAuthResult?.(true);
            break;
          }

          case 'auth_fail': {
            this.isConnecting = false;
            this.statusBar.setConnectionState('offline');
            this.authModal.show();
            this.authModal.showError(msg.error || '认证失败');
            onAuthResult?.(false);
            if (this.ws) {
              this.ws.close();
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
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWebSocket();
    }, 3000);
  }

  private reconnect(): void {
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
