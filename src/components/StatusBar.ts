export type ConnectionState = 'online' | 'reconnecting' | 'offline';

export interface StatusBarCallbacks {
  onToggleKeyboard: () => void;
  onReconnect: () => void;
  onOpenPasswordModal: () => void;
  onOpenASRModal: () => void;
  onToggleNativeIME: () => void;
  onGetFontSize: () => number;
  onSetFontSize: (size: number) => number;
  onSwitchView?: (view: 'terminal' | 'files') => void;
}

export class StatusBar {
  private container: HTMLElement;
  private statusPill: HTMLElement;
  private statusText: HTMLElement;
  private statusPingWrapper: HTMLElement;
  private pingEl: HTMLElement;
  private fontPopover: HTMLElement;
  private fontSizeVal: HTMLElement;
  private fontSlider: HTMLInputElement;
  private fontChips: NodeListOf<HTMLButtonElement>;
  private keyIndicatorEl: HTMLElement;
  private keyIndicatorTimer: NodeJS.Timeout | null = null;
  private callbacks: StatusBarCallbacks;
  private activeView: 'terminal' | 'files' = 'terminal';

  constructor(callbacks: StatusBarCallbacks) {
    this.callbacks = callbacks;
    this.container = document.createElement('header');
    this.container.className = 'cyber-status-bar';

    this.container.innerHTML = `
      <div class="bar-left">
        <div class="status-pill status-offline" title="会话状态与延迟">
          <span class="status-dot"></span>
          <span class="status-text">OFFLINE</span>
          <span class="status-ping-wrapper" style="display: none;">
            <span class="status-sep">/</span>
            <span class="status-ping">-- ms</span>
          </span>
        </div>

        <!-- Key Feedback Indicator Pill (transient neon tag for Escape and hotkeys) -->
        <div class="key-indicator-pill" style="display: none;">ESC</div>

        <!-- View Mode Switcher (Icon only, consistent height with other bar-btn) -->
        <div class="cyber-view-switcher">
          <button type="button" class="bar-btn view-tab-btn active" data-view="terminal" title="终端视图 (Alt+F)">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="4 17 10 11 4 5"></polyline>
              <line x1="12" y1="19" x2="20" y2="19"></line>
            </svg>
          </button>
          <button type="button" class="bar-btn view-tab-btn" data-view="files" title="文件管理器视图 (Alt+F)">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
          </button>
        </div>
      </div>

      <div class="bar-center"></div>

      <div class="bar-right">
        <!-- Font Size Adjustment Button & Popover -->
        <div class="font-control-wrapper">
          <button type="button" class="bar-btn btn-font-size" title="调整终端字体大小">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 19L9.5 5L15 19"></path>
              <path d="M6 14H13"></path>
              <path d="M18 10V16"></path>
              <path d="M15 13H21"></path>
            </svg>
          </button>
          <div class="cyber-font-popover" style="display: none;">
            <div class="font-popover-header">
              <span class="font-popover-title">终端字号</span>
              <span class="font-popover-val">14px</span>
            </div>
            <div class="font-slider-row">
              <input type="range" class="font-range-slider" min="6" max="24" step="1" value="14" />
            </div>
            <div class="font-stepper-row">
              <button type="button" class="font-stepper-btn btn-font-dec" title="减小字体 (A-)">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                <span>A- 减小</span>
              </button>
              <button type="button" class="font-stepper-btn btn-font-inc" title="增大字体 (A+)">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                <span>A+ 增大</span>
              </button>
            </div>
            <div class="font-chips-wrap">
              <button type="button" class="font-chip" data-size="8">8</button>
              <button type="button" class="font-chip" data-size="10">10</button>
              <button type="button" class="font-chip" data-size="12">12</button>
              <button type="button" class="font-chip" data-size="14">14</button>
              <button type="button" class="font-chip" data-size="16">16</button>
            </div>
          </div>
        </div>

        <button type="button" class="bar-btn btn-native-ime" title="切换手机原生输入法">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="4" width="20" height="16" rx="2"></rect>
            <path d="M7 15h10M4 9h.01M8 9h.01M12 9h.01M16 9h.01M20 9h.01M6 12h.01M18 12h.01"></path>
          </svg>
        </button>
        <button type="button" class="bar-btn btn-asr-config" title="配置语音识别引擎 (默认浏览器原生/Mega-ASR)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
        </button>
        <button type="button" class="bar-btn btn-change-pwd" title="修改进入密码 (前端加密)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
        </button>
        <button type="button" class="bar-btn btn-reconnect" title="重新连接会话">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"></polyline>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
          </svg>
        </button>
        <button type="button" class="bar-btn btn-toggle-kb" title="展开/折叠虚拟键盘">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect>
            <line x1="6" y1="8" x2="6" y2="8"></line>
            <line x1="10" y1="8" x2="10" y2="8"></line>
            <line x1="14" y1="8" x2="14" y2="8"></line>
            <line x1="18" y1="8" x2="18" y2="8"></line>
            <line x1="6" y1="12" x2="6" y2="12"></line>
            <line x1="10" y1="12" x2="10" y2="12"></line>
            <line x1="14" y1="12" x2="14" y2="12"></line>
            <line x1="18" y1="12" x2="18" y2="12"></line>
            <line x1="8" y1="16" x2="16" y2="16"></line>
          </svg>
        </button>
        <button type="button" class="bar-btn btn-fullscreen" title="全屏切换">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
          </svg>
        </button>
      </div>
    `;

    this.statusPill = this.container.querySelector('.status-pill')!;
    this.statusText = this.container.querySelector('.status-text')!;
    this.statusPingWrapper = this.container.querySelector('.status-ping-wrapper')!;
    this.pingEl = this.container.querySelector('.status-ping')!;
    this.keyIndicatorEl = this.container.querySelector('.key-indicator-pill')!;

    this.fontPopover = this.container.querySelector('.cyber-font-popover')!;
    this.fontSizeVal = this.container.querySelector('.font-popover-val')!;
    this.fontSlider = this.container.querySelector('.font-range-slider')!;
    this.fontChips = this.container.querySelectorAll('.font-chip');

    this.initFontControls();

    // Bind events
    this.container.querySelector('.btn-native-ime')!.addEventListener('click', () => {
      this.callbacks.onToggleNativeIME();
    });

    this.container.querySelector('.btn-asr-config')!.addEventListener('click', () => {
      this.callbacks.onOpenASRModal();
    });

    this.container.querySelector('.btn-change-pwd')!.addEventListener('click', () => {
      this.callbacks.onOpenPasswordModal();
    });

    this.container.querySelector('.btn-toggle-kb')!.addEventListener('click', () => {
      this.callbacks.onToggleKeyboard();
    });

    this.container.querySelector('.btn-reconnect')!.addEventListener('click', () => {
      this.callbacks.onReconnect();
    });

    this.container.querySelector('.btn-fullscreen')!.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    // View tab buttons
    this.container.querySelectorAll<HTMLButtonElement>('.view-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetView = btn.getAttribute('data-view') as 'terminal' | 'files';
        if (targetView && targetView !== this.activeView) {
          this.setActiveView(targetView);
          this.callbacks.onSwitchView?.(targetView);
        }
      });
    });
  }

  public setActiveView(view: 'terminal' | 'files'): void {
    this.activeView = view;
    this.container.querySelectorAll<HTMLButtonElement>('.view-tab-btn').forEach((btn) => {
      if (btn.getAttribute('data-view') === view) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    const center = this.container.querySelector<HTMLElement>('.bar-center');
    if (center) {
      center.style.display = view === 'terminal' ? 'flex' : 'none';
    }
  }

  private initFontControls(): void {
    const fontBtn = this.container.querySelector('.btn-font-size')!;

    // Toggle popover
    fontBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = this.fontPopover.style.display === 'block';
      if (isVisible) {
        this.closeFontPopover();
      } else {
        this.openFontPopover();
      }
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (!this.fontPopover.contains(e.target as Node) && !fontBtn.contains(e.target as Node)) {
        this.closeFontPopover();
      }
    });

    // Prevent popover clicks from bubbling
    this.fontPopover.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Minus button
    this.container.querySelector('.btn-font-dec')!.addEventListener('click', () => {
      const cur = this.callbacks.onGetFontSize();
      const updated = this.callbacks.onSetFontSize(cur - 1);
      this.updateFontUI(updated);
    });

    // Plus button
    this.container.querySelector('.btn-font-inc')!.addEventListener('click', () => {
      const cur = this.callbacks.onGetFontSize();
      const updated = this.callbacks.onSetFontSize(cur + 1);
      this.updateFontUI(updated);
    });

    // Chips
    this.fontChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        const size = parseInt(chip.getAttribute('data-size') || '14', 10);
        const updated = this.callbacks.onSetFontSize(size);
        this.updateFontUI(updated);
      });
    });

    // Range slider
    this.fontSlider.addEventListener('input', () => {
      const size = parseInt(this.fontSlider.value, 10);
      const updated = this.callbacks.onSetFontSize(size);
      this.updateFontUI(updated);
    });

    // Auto-reposition if window resizes or rotates while open
    window.addEventListener('resize', () => {
      if (this.fontPopover && this.fontPopover.style.display === 'block') {
        this.adjustPopoverPosition();
      }
    });
  }

  public openFontPopover(): void {
    const curSize = this.callbacks.onGetFontSize();
    this.updateFontUI(curSize);
    this.fontPopover.style.display = 'block';
    this.adjustPopoverPosition();
  }

  public closeFontPopover(): void {
    this.fontPopover.style.display = 'none';
  }

  private adjustPopoverPosition(): void {
    const fontBtn = this.container.querySelector('.btn-font-size') as HTMLElement;
    if (!fontBtn || !this.fontPopover) return;

    const btnRect = fontBtn.getBoundingClientRect();
    const screenWidth = window.innerWidth || document.documentElement.clientWidth;
    const popoverWidth = Math.min(230, screenWidth - 16);

    // Center under button with screen edge clamping
    let left = btnRect.left + (btnRect.width / 2) - (popoverWidth / 2);
    const minLeft = 8;
    const maxLeft = screenWidth - popoverWidth - 8;
    left = Math.max(minLeft, Math.min(left, maxLeft));

    this.fontPopover.style.position = 'fixed';
    this.fontPopover.style.top = `${Math.round(btnRect.bottom + 6)}px`;
    this.fontPopover.style.left = `${Math.round(left)}px`;
    this.fontPopover.style.right = 'auto';
    this.fontPopover.style.width = `${popoverWidth}px`;
    this.fontPopover.style.boxSizing = 'border-box';
    this.fontPopover.style.zIndex = '9999';
  }

  public updateFontUI(size: number): void {
    this.fontSizeVal.textContent = `${size}px`;
    if (this.fontSlider) {
      this.fontSlider.value = size.toString();
    }
    this.fontChips.forEach((chip) => {
      const chipSize = parseInt(chip.getAttribute('data-size') || '0', 10);
      chip.classList.toggle('active', chipSize === size);
    });
  }

  public getElement(): HTMLElement {
    return this.container;
  }

  public setConnectionState(state: ConnectionState): void {
    this.statusPill.className = `status-pill status-${state}`;
    this.statusText.textContent = state.toUpperCase();

    if (state === 'online') {
      this.statusPingWrapper.style.display = 'inline-flex';
    } else {
      this.statusPingWrapper.style.display = 'none';
    }
  }

  public setPing(ms: number): void {
    this.pingEl.textContent = `${ms} ms`;
    if (ms < 80) {
      this.pingEl.style.color = '#00ff9f';
    } else if (ms < 200) {
      this.pingEl.style.color = '#ffb86c';
    } else {
      this.pingEl.style.color = '#ff3860';
    }
  }

  public setSessionId(_id: string): void {
    // Session badge removed per user request
  }

  public showKeyIndicator(label = 'ESC'): void {
    if (!this.keyIndicatorEl) return;
    this.keyIndicatorEl.textContent = label;
    this.keyIndicatorEl.style.display = 'inline-flex';
    this.keyIndicatorEl.classList.remove('fade-out');
    if (this.keyIndicatorTimer) {
      clearTimeout(this.keyIndicatorTimer);
    }
    this.keyIndicatorTimer = setTimeout(() => {
      this.keyIndicatorEl.classList.add('fade-out');
      setTimeout(() => {
        if (this.keyIndicatorEl && this.keyIndicatorEl.classList.contains('fade-out')) {
          this.keyIndicatorEl.style.display = 'none';
        }
      }, 200);
    }, 400);
  }

  public setTabBar(tabBarElement: HTMLElement): void {
    const center = this.container.querySelector('.bar-center');
    if (center) {
      center.innerHTML = '';
      center.appendChild(tabBarElement);
    }
  }
}
