import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

export interface TerminalManagerOptions {
  container: HTMLElement;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onEscapeFeedback?: () => void;
}

export class TerminalManager {
  private terminal: Terminal;
  private fitAddon: FitAddon;
  private container: HTMLElement;
  private onResizeCallback: (cols: number, rows: number) => void;
  private onInputCallback: (data: string) => void;
  private resizeObserver: ResizeObserver | null = null;
  private inertiaAnimFrame: number | null = null;
  private isReplayingHistory = false;

  constructor(options: TerminalManagerOptions) {
    this.container = options.container;
    this.onResizeCallback = options.onResize;
    this.onInputCallback = options.onInput;

    const savedFontSize = parseInt(localStorage.getItem('webterm_font_size') || '14', 10);
    const initialFontSize = (!isNaN(savedFontSize) && savedFontSize >= 6 && savedFontSize <= 32) ? savedFontSize : 14;

    this.terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, monospace',
      fontSize: initialFontSize,
      lineHeight: 1.25,
      letterSpacing: 0,
      scrollback: 5000,
      convertEol: true,
      allowProposedApi: true,
      theme: {
        background: '#0b0e14',
        foreground: '#e6edf3',
        cursor: '#00e5ff',
        cursorAccent: '#0b0e14',
        selectionBackground: 'rgba(0, 229, 255, 0.35)',
        selectionForeground: '#ffffff',
        selectionInactiveBackground: 'rgba(0, 229, 255, 0.18)',
        black: '#0d1117',
        red: '#ff5555',
        green: '#00ff9f',
        yellow: '#f1fa8c',
        blue: '#00e5ff',
        magenta: '#bd93f9',
        cyan: '#8be9fd',
        white: '#f8f8f2',
        brightBlack: '#6272a4',
        brightRed: '#ff6e6e',
        brightGreen: '#69ff94',
        brightYellow: '#ffffa5',
        brightBlue: '#d6acff',
        brightMagenta: '#ff92df',
        brightCyan: '#a4ffff',
        brightWhite: '#ffffff'
      }
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon());

    this.terminal.open(this.container);

    // Prevent OS IME (fcitx5/ibus) from attaching and swallowing physical Escape key,
    // while keeping all standard keyboard events (Alphanumeric, Escape, Enter, Ctrl+C, etc.) and paste active.
    const helperTextarea = this.container.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement;
    if (helperTextarea) {
      helperTextarea.readOnly = true;
      helperTextarea.tabIndex = 0;
      helperTextarea.setAttribute('autocomplete', 'off');
      helperTextarea.setAttribute('autocorrect', 'off');
      helperTextarea.setAttribute('autocapitalize', 'off');
      helperTextarea.setAttribute('spellcheck', 'false');

      // Keep readOnly on focus & suppress virtual keyboard on mobile touch devices
      helperTextarea.addEventListener('focus', () => {
        helperTextarea.readOnly = true;
        const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        if (isTouch) {
          helperTextarea.setAttribute('inputmode', 'none');
        }
      });
    }

    // Capture user direct typing (physical keyboard or paste)
    this.terminal.onData((data) => {
      // Suppress automated terminal query responses triggered during history replay
      if (this.isReplayingHistory) {
        return;
      }
      options.onInput(data);
    });

    // Ensure physical Escape key (and Ctrl+[) is directly intercepted and dispatched to terminal backend
    // (Bypasses browser IME cancellation and xterm keyCode 229/0 dropping)
    this.terminal.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
      const isEscape = ev.key === 'Escape' || ev.code === 'Escape' || ev.keyCode === 27 ||
        (ev.ctrlKey && !ev.altKey && !ev.metaKey && (ev.key === '[' || ev.code === 'BracketLeft' || ev.keyCode === 219));
      if (isEscape) {
        if (ev.type === 'keydown') {
          ev.preventDefault();
          ev.stopPropagation();
          options.onInput(ev.altKey ? '\x1b\x1b' : '\x1b');
          options.onEscapeFeedback?.();
        }
        return false;
      }
      return true;
    });

    // Ensure terminal focuses when clicking or tapping anywhere in the container
    this.container.addEventListener('pointerdown', () => {
      if (helperTextarea) {
        helperTextarea.readOnly = true;
      }
      this.terminal.focus();
    });

    // Auto-fit on container size changes
    this.setupResizeObserver();

    // Enable finger touch drag scrolling with momentum inertia
    this.setupTouchScroll();
  }

  public fit(): void {
    try {
      if (!this.container || this.container.clientWidth <= 0 || this.container.clientHeight <= 0) {
        return;
      }
      this.fitAddon.fit();
      const cols = this.terminal.cols;
      const rows = this.terminal.rows;
      if (cols > 10 && rows > 2) {
        this.onResizeCallback(cols, rows);
      }
    } catch (err) {
      console.warn('[TerminalManager] Fit error:', err);
    }
  }

  public write(data: string): void {
    this.terminal.write(data);
  }

  public writeHistory(data: string, onComplete?: () => void): void {
    this.isReplayingHistory = true;
    this.terminal.write(data, () => {
      this.isReplayingHistory = false;
      onComplete?.();
    });
  }

  public clear(): void {
    this.terminal.clear();
  }

  public focus(): void {
    const helperTextarea = this.container.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement;
    if (helperTextarea) {
      helperTextarea.readOnly = true;
    }
    this.terminal.focus();
  }

  public getCols(): number {
    return this.terminal.cols;
  }

  public getRows(): number {
    return this.terminal.rows;
  }

  public getFontSize(): number {
    return this.terminal.options.fontSize || 14;
  }

  public setFontSize(size: number): number {
    const clamped = Math.max(6, Math.min(32, size));
    this.terminal.options.fontSize = clamped;
    try {
      localStorage.setItem('webterm_font_size', clamped.toString());
    } catch {}
    this.fit();
    return clamped;
  }

  public zoomIn(): number {
    return this.setFontSize(this.getFontSize() + 1);
  }

  public zoomOut(): number {
    return this.setFontSize(this.getFontSize() - 1);
  }

  private setupResizeObserver(): void {
    let timeout: NodeJS.Timeout | null = null;
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.container || this.container.clientWidth <= 0 || this.container.clientHeight <= 0) {
        return;
      }
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        this.fit();
      }, 50);
    });
    this.resizeObserver.observe(this.container);

    window.addEventListener('resize', () => {
      this.fit();
    });
  }

  private setupTouchScroll(): void {
    let startY = 0;
    let startX = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;
    let accumulatedDeltaY = 0;
    let isTouchScrolling = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      if (this.inertiaAnimFrame !== null) {
        cancelAnimationFrame(this.inertiaAnimFrame);
        this.inertiaAnimFrame = null;
      }

      const touch = e.touches[0];
      startY = touch.clientY;
      startX = touch.clientX;
      lastY = startY;
      lastTime = performance.now();
      velocity = 0;
      accumulatedDeltaY = 0;
      isTouchScrolling = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const currentY = touch.clientY;
      const currentX = touch.clientX;
      const deltaY = currentY - lastY;
      const totalDeltaY = currentY - startY;
      const totalDeltaX = currentX - startX;

      // Detect if user intended a vertical scrolling gesture
      if (!isTouchScrolling) {
        if (Math.abs(totalDeltaY) > 8 && Math.abs(totalDeltaY) > Math.abs(totalDeltaX)) {
          isTouchScrolling = true;
        }
      }

      if (!isTouchScrolling) return;

      // Prevent native browser viewport rubber-banding / bounce
      if (e.cancelable) {
        e.preventDefault();
      }

      const now = performance.now();
      const dt = now - lastTime;
      if (dt > 0) {
        const instantVelocity = deltaY / dt;
        velocity = velocity * 0.35 + instantVelocity * 0.65;
      }
      lastTime = now;
      lastY = currentY;

      accumulatedDeltaY += deltaY;

      const lineHeight = (this.terminal.options.fontSize || 14) * (this.terminal.options.lineHeight || 1.25);
      const step = Math.max(12, lineHeight);

      // Check if we are in alternate buffer (e.g. vim, nano, less, htop)
      const isAltBuffer = this.terminal.buffer.active.type === 'alternate';

      if (isAltBuffer) {
        // In alternate buffer, send arrow up / down key sequences to scroll
        const lines = Math.trunc(accumulatedDeltaY / step);
        if (lines !== 0) {
          accumulatedDeltaY -= lines * step;
          const arrow = lines > 0 ? '\x1b[A' : '\x1b[B';
          const count = Math.abs(lines);
          for (let i = 0; i < count; i++) {
            this.onInputCallback(arrow);
          }
        }
      } else {
        // In normal buffer, scroll terminal history lines
        const lines = Math.trunc(accumulatedDeltaY / step);
        if (lines !== 0) {
          accumulatedDeltaY -= lines * step;
          // Drag down (lines > 0) reveals history above -> scrollLines(-lines)
          // Drag up (lines < 0) reveals lines below -> scrollLines(-lines)
          this.terminal.scrollLines(-lines);
        }
      }
    };

    const onTouchEnd = () => {
      if (!isTouchScrolling) return;
      isTouchScrolling = false;

      // Momentum inertial scrolling for normal buffer
      const isAltBuffer = this.terminal.buffer.active.type === 'alternate';
      if (!isAltBuffer && Math.abs(velocity) > 0.18) {
        let v = velocity;
        const friction = 0.91;
        const momentumStep = () => {
          v *= friction;
          if (Math.abs(v) < 0.04) {
            this.inertiaAnimFrame = null;
            return;
          }
          const lines = Math.round(v * 1.5);
          if (lines !== 0) {
            this.terminal.scrollLines(-lines);
          }
          this.inertiaAnimFrame = requestAnimationFrame(momentumStep);
        };
        this.inertiaAnimFrame = requestAnimationFrame(momentumStep);
      }
    };

    // Use capture: true to ensure touch events are intercepted before being swallowed
    this.container.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    this.container.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    this.container.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    this.container.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true });
  }

  private externalScrollDelta = 0;

  public scrollByDeltaY(deltaY: number): void {
    this.externalScrollDelta += deltaY;
    const lineHeight = (this.terminal.options.fontSize || 14) * (this.terminal.options.lineHeight || 1.25);
    const step = Math.max(12, lineHeight);
    const isAltBuffer = this.terminal.buffer.active.type === 'alternate';

    const lines = Math.trunc(this.externalScrollDelta / step);
    if (lines !== 0) {
      this.externalScrollDelta -= lines * step;
      if (isAltBuffer) {
        const arrow = lines > 0 ? '\x1b[A' : '\x1b[B';
        const count = Math.abs(lines);
        for (let i = 0; i < count; i++) {
          this.onInputCallback(arrow);
        }
      } else {
        this.terminal.scrollLines(-lines);
      }
    }
  }

  public dispose(): void {
    if (this.inertiaAnimFrame !== null) {
      cancelAnimationFrame(this.inertiaAnimFrame);
      this.inertiaAnimFrame = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.terminal.dispose();
  }
}
