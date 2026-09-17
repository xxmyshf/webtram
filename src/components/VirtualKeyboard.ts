import { SpeechManager } from './SpeechManager.js';
import { VoiceInputHUD } from './VoiceInputHUD.js';

export interface VirtualKeyboardOptions {
  onInput: (data: string) => void;
  onResizeTrigger?: () => void;
  onToggleNativeIME?: () => void;
  speechManager: SpeechManager;
}

export class VirtualKeyboard {
  private container: HTMLElement;
  private onInput: (data: string) => void;
  private onResizeTrigger?: () => void;
  private onToggleNativeIME?: () => void;

  // Portrait collapse state
  private isCollapsed = false;

  // Landscape individual panel collapse states
  private isLeftCollapsed = false;
  private isRightCollapsed = false;

  // Latch mode for Ctrl
  private ctrlLatched = false;

  // Shift and Caps Lock
  private isShiftActive = false;
  private isCapsLock = false;
  private lastShiftClickTime = 0;

  // Debounce duplicate pointer/touch events
  private lastInputTime = 0;
  private lastInputValue = '';

  // Current sub-layout: 'alpha' | 'symbols'
  private currentMode: 'alpha' | 'symbols' = 'alpha';

  // Continuous arrow key repeat timers
  private repeatTimer: NodeJS.Timeout | null = null;
  private repeatInterval: NodeJS.Timeout | null = null;

  // Voice recording state
  private speechManager: SpeechManager;
  private voiceHUD: VoiceInputHUD;
  private voicePressTimer: NodeJS.Timeout | null = null;
  private isVoiceRecording = false;
  private voiceStartY = 0;
  private isVoiceCancelled = false;

  constructor(options: VirtualKeyboardOptions) {
    this.onInput = options.onInput;
    this.onResizeTrigger = options.onResizeTrigger;
    this.onToggleNativeIME = options.onToggleNativeIME;
    this.speechManager = options.speechManager;

    this.voiceHUD = new VoiceInputHUD();

    this.container = document.createElement('div');
    this.container.className = 'cyber-virtual-keyboard';

    this.render();

    // Global pointerup to ensure voice/repeat touches are released even if dragged outside
    window.addEventListener('pointerup', () => this.handleGlobalPointerUp());
    window.addEventListener('pointercancel', () => this.handleGlobalPointerUp());
    window.addEventListener('pointermove', (e) => this.handleGlobalPointerMove(e));

    // Monitor orientation change to trigger terminal fit
    window.matchMedia('(orientation: landscape)').addEventListener('change', () => {
      setTimeout(() => this.onResizeTrigger?.(), 150);
    });
  }

  public hide(): void {
    this.container.classList.add('hidden-by-ime');
    setTimeout(() => this.onResizeTrigger?.(), 100);
  }

  public show(): void {
    this.container.classList.remove('hidden-by-ime');
    setTimeout(() => this.onResizeTrigger?.(), 100);
  }

  public toggleCollapse(force?: boolean): void {
    this.isCollapsed = force !== undefined ? force : !this.isCollapsed;
    this.container.classList.toggle('collapsed', this.isCollapsed);
    if (this.onResizeTrigger) {
      setTimeout(() => this.onResizeTrigger?.(), 250);
    }
  }

  public getElement(): HTMLElement {
    return this.container;
  }

  private triggerHaptic(duration = 15): void {
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(duration);
      } catch {}
    }
  }

  private render(): void {
    this.container.innerHTML = '';

    // 1. Single Unified Keyboard for Portrait mode
    const portraitWrapper = document.createElement('div');
    portraitWrapper.className = 'cyber-portrait-kb';

    const headerBar = document.createElement('div');
    headerBar.className = 'keyboard-header-bar';
    headerBar.innerHTML = `
      <div class="keyboard-drag-handle"></div>
      <div class="keyboard-controls">
        <button type="button" class="btn-kb-toggle" title="折叠/展开键盘">
          <svg class="toggle-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
      </div>
    `;
    headerBar.addEventListener('click', () => this.toggleCollapse());
    portraitWrapper.appendChild(headerBar);
    portraitWrapper.appendChild(this.createKeyboardBody('portrait'));
    this.container.appendChild(portraitWrapper);

    // 2. Dual Split Keyboards for Landscape mode
    const landscapeWrapper = document.createElement('div');
    landscapeWrapper.className = 'cyber-landscape-split-kb';
    landscapeWrapper.appendChild(this.createSplitPanel('left'));
    landscapeWrapper.appendChild(this.createSplitPanel('right'));
    this.container.appendChild(landscapeWrapper);

    // 3. Floating Edge Expand Buttons (visible on screen edges in landscape when collapsed)
    const edgeExpandLeft = document.createElement('button');
    edgeExpandLeft.type = 'button';
    edgeExpandLeft.className = 'btn-edge-expand expand-left';
    edgeExpandLeft.title = '展开左侧键盘';
    edgeExpandLeft.innerHTML = `
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6"></polyline>
      </svg>
    `;
    edgeExpandLeft.addEventListener('click', (e) => {
      e.stopPropagation();
      this.triggerButtonFlash(edgeExpandLeft);
      this.toggleSplitPanelCollapse('left', false);
    });
    this.container.appendChild(edgeExpandLeft);

    const edgeExpandRight = document.createElement('button');
    edgeExpandRight.type = 'button';
    edgeExpandRight.className = 'btn-edge-expand expand-right';
    edgeExpandRight.title = '展开右侧键盘';
    edgeExpandRight.innerHTML = `
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"></polyline>
      </svg>
    `;
    edgeExpandRight.addEventListener('click', (e) => {
      e.stopPropagation();
      this.triggerButtonFlash(edgeExpandRight);
      this.toggleSplitPanelCollapse('right', false);
    });
    this.container.appendChild(edgeExpandRight);
  }

  private triggerButtonFlash(el: HTMLElement): void {
    el.classList.add('flash-glow');
    setTimeout(() => {
      el.classList.remove('flash-glow');
    }, 120);
  }

  /**
   * Creates a dedicated split panel (Left or Right) for Landscape mode
   */
  private createSplitPanel(side: 'left' | 'right'): HTMLElement {
    const panel = document.createElement('div');
    panel.className = `cyber-split-panel panel-${side}`;

    const header = document.createElement('div');
    header.className = `split-panel-header header-${side}`;

    if (side === 'left') {
      header.innerHTML = `
        <button type="button" class="btn-split-toggle btn-toggle-left" title="收起左侧键盘">
          <svg class="toggle-icon toggle-icon-left" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <div class="split-panel-badge">
          <span class="badge-dot"></span>
          <span>L</span>
        </div>
      `;
    } else {
      header.innerHTML = `
        <div class="split-panel-badge">
          <span>R</span>
          <span class="badge-dot"></span>
        </div>
        <button type="button" class="btn-split-toggle btn-toggle-right" title="收起右侧键盘">
          <svg class="toggle-icon toggle-icon-right" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
      `;
    }

    const toggleBtn = header.querySelector('.btn-split-toggle') as HTMLElement;
    toggleBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.triggerButtonFlash(toggleBtn);
      this.toggleSplitPanelCollapse(side);
    });

    header.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSplitPanelCollapse(side);
    });

    panel.appendChild(header);
    panel.appendChild(this.createKeyboardBody(side));

    return panel;
  }

  public toggleSplitPanelCollapse(side: 'left' | 'right', force?: boolean): void {
    const appEl = document.getElementById('app');
    if (side === 'left') {
      this.isLeftCollapsed = force !== undefined ? force : !this.isLeftCollapsed;
      const panel = this.container.querySelector('.panel-left') as HTMLElement;
      if (panel) panel.classList.toggle('collapsed', this.isLeftCollapsed);
      appEl?.classList.toggle('is-left-collapsed', this.isLeftCollapsed);
      const btn = panel?.querySelector('.btn-toggle-left') as HTMLElement;
      if (btn) this.triggerButtonFlash(btn);
    } else {
      this.isRightCollapsed = force !== undefined ? force : !this.isRightCollapsed;
      const panel = this.container.querySelector('.panel-right') as HTMLElement;
      if (panel) panel.classList.toggle('collapsed', this.isRightCollapsed);
      appEl?.classList.toggle('is-right-collapsed', this.isRightCollapsed);
      const btn = panel?.querySelector('.btn-toggle-right') as HTMLElement;
      if (btn) this.triggerButtonFlash(btn);
    }
    this.triggerHaptic(15);
    setTimeout(() => this.onResizeTrigger?.(), 50);
    setTimeout(() => this.onResizeTrigger?.(), 280);
  }

  private createKeyboardBody(variant: 'portrait' | 'left' | 'right'): HTMLElement {
    const body = document.createElement('div');
    body.className = 'keyboard-inner-body';

    // Row 1: CLI Quick Toolbar (7 keys on left half, 7 keys on right half)
    body.appendChild(this.createQuickToolbar());

    // Main dynamic keys area (Row 2: Numbers, Row 3-5: Keys, Row 6: Actions)
    const mainKeys = document.createElement('div');
    mainKeys.className = 'keyboard-main-rows';
    mainKeys.appendChild(this.createMainKeys(variant));
    body.appendChild(mainKeys);

    return body;
  }

  private updateMainRows(): void {
    const portraitMain = this.container.querySelector('.cyber-portrait-kb .keyboard-main-rows');
    if (portraitMain) {
      portraitMain.innerHTML = '';
      portraitMain.appendChild(this.createMainKeys('portrait'));
    }

    const leftMain = this.container.querySelector('.panel-left .keyboard-main-rows');
    if (leftMain) {
      leftMain.innerHTML = '';
      leftMain.appendChild(this.createMainKeys('left'));
    }

    const rightMain = this.container.querySelector('.panel-right .keyboard-main-rows');
    if (rightMain) {
      rightMain.innerHTML = '';
      rightMain.appendChild(this.createMainKeys('right'));
    }
  }

  /**
   * Helper to construct a row with left and right halves
   */
  private createSplitRow(leftKeys: HTMLElement[], rightKeys: HTMLElement[]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'keyboard-row';

    const leftHalf = document.createElement('div');
    leftHalf.className = 'kb-half kb-half-left';
    for (const k of leftKeys) leftHalf.appendChild(k);

    const rightHalf = document.createElement('div');
    rightHalf.className = 'kb-half kb-half-right';
    for (const k of rightKeys) rightHalf.appendChild(k);

    row.appendChild(leftHalf);
    row.appendChild(rightHalf);
    return row;
  }

  /**
   * Row 1: CLI Quick Toolbar (7 keys on left, 7 keys on right)
   */
  private createQuickToolbar(): HTMLElement {
    const toolsLeft: Array<{ label: string; value?: string; special?: string; repeat?: boolean }> = [
      { label: 'Esc', value: '\x1b' },
      { label: '^', special: 'ctrl-latch' },
      { label: '^C', value: '\x03' },
      { label: 'Tab', value: '\t' },
      { label: '^D', value: '\x04' },
      { label: '|', value: '|' },
      { label: '-', value: '-' }
    ];

    const toolsRight: Array<{ label: string; value?: string; special?: string; repeat?: boolean }> = [
      { label: '~', value: '~' },
      { label: '/', value: '/' },
      { label: '.', value: '.' },
      { label: '↑', value: '\x1b[A', repeat: true },
      { label: '↓', value: '\x1b[B', repeat: true },
      { label: '←', value: '\x1b[D', repeat: true },
      { label: '→', value: '\x1b[C', repeat: true }
    ];

    const leftBtns = toolsLeft.map((item) => this.createToolButton(item));
    const rightBtns = toolsRight.map((item) => this.createToolButton(item));

    const row = this.createSplitRow(leftBtns, rightBtns);
    row.classList.add('quick-toolbar');
    return row;
  }

  private createToolButton(item: { label: string; value?: string; special?: string; repeat?: boolean }): HTMLElement {
    const keyBtn = document.createElement('button');
    keyBtn.type = 'button';
    keyBtn.className = 'keycap key-fn key-toolbar-compact';
    keyBtn.dataset.key = item.label;

    if (item.special === 'ctrl-latch') {
      keyBtn.classList.add('key-ctrl');
      if (this.ctrlLatched) keyBtn.classList.add('latched');
      keyBtn.innerHTML = `<span>^</span><span class="ctrl-indicator"></span>`;
      keyBtn.title = 'Ctrl 锁存模式';
      keyBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggleCtrlLatch();
      });
    } else if (item.repeat) {
      keyBtn.textContent = item.label;
      keyBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.startKeyRepeat(item.value!);
      });
    } else {
      keyBtn.textContent = item.label;
      keyBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handleKeyPress(item.value!);
      });
    }

    return keyBtn;
  }

  /**
   * Creates Alpha or Symbol layout with split left/right structure
   */
  private createMainKeys(variant: 'portrait' | 'left' | 'right'): HTMLElement {
    const fragment = document.createDocumentFragment();

    if (this.currentMode === 'alpha') {
      const isUpper = this.isShiftActive || this.isCapsLock;

      // Row 2: Dedicated Numbers Row (1 2 3 4 5 | 6 7 8 9 0)
      const numLeft = ['1', '2', '3', '4', '5'].map((n) => this.createCharKey(n));
      const numRight = ['6', '7', '8', '9', '0'].map((n) => this.createCharKey(n));
      const r2 = this.createSplitRow(numLeft, numRight);
      r2.classList.add('number-row');
      fragment.appendChild(r2);

      // Row 3: Letters Q-P (q w e r t | y u i o p)
      const r3Left = ['q', 'w', 'e', 'r', 't'].map((c) => this.createCharKey(isUpper ? c.toUpperCase() : c));
      const r3Right = ['y', 'u', 'i', 'o', 'p'].map((c) => this.createCharKey(isUpper ? c.toUpperCase() : c));
      fragment.appendChild(this.createSplitRow(r3Left, r3Right));

      // Row 4: Letters A-L (a s d f g | h j k l)
      const r4Left = ['a', 's', 'd', 'f', 'g'].map((c) => this.createCharKey(isUpper ? c.toUpperCase() : c));
      const r4Right = ['h', 'j', 'k', 'l'].map((c) => this.createCharKey(isUpper ? c.toUpperCase() : c));
      fragment.appendChild(this.createSplitRow(r4Left, r4Right));

      // Row 5: Shift + Z-M + Backspace ([Shift] z x c v | b n m [Bksp])
      const r5Left = [
        this.createShiftButton(),
        ...['z', 'x', 'c', 'v'].map((c) => this.createCharKey(isUpper ? c.toUpperCase() : c))
      ];
      const r5Right = [
        ...['b', 'n', 'm'].map((c) => this.createCharKey(isUpper ? c.toUpperCase() : c)),
        this.createBackspaceButton()
      ];
      fragment.appendChild(this.createSplitRow(r5Left, r5Right));

      // Row 6: Switcher (?123) + Actions + Space + Enter
      fragment.appendChild(this.createBottomRow(variant, '?123'));
    } else {
      // Symbols Mode
      // Row 2: Top Symbols (! @ # $ % | ^ & * ( ))
      const symLeft = ['!', '@', '#', '$', '%'].map((s) => this.createCharKey(s));
      const symRight = ['^', '&', '*', '(', ')'].map((s) => this.createCharKey(s));
      const r2 = this.createSplitRow(symLeft, symRight);
      r2.classList.add('symbol-row');
      fragment.appendChild(r2);

      // Row 3: Numbers row in symbols (1 2 3 4 5 | 6 7 8 9 0)
      const numLeft = ['1', '2', '3', '4', '5'].map((n) => this.createCharKey(n));
      const numRight = ['6', '7', '8', '9', '0'].map((n) => this.createCharKey(n));
      fragment.appendChild(this.createSplitRow(numLeft, numRight));

      // Row 4: Brackets & arithmetic ([ ] { } < | > _ + = \)
      const r4Left = ['[', ']', '{', '}', '<'].map((s) => this.createCharKey(s));
      const r4Right = ['>', '_', '+', '=', '\\'].map((s) => this.createCharKey(s));
      fragment.appendChild(this.createSplitRow(r4Left, r4Right));

      // Row 5: Punctuation & Backspace (: ; " ' | , . ? ` [Bksp])
      const r5Left = [':', ';', '"', "'"].map((s) => this.createCharKey(s));
      const r5Right = [',', '.', '?', '`'].map((s) => this.createCharKey(s));
      r5Right.push(this.createBackspaceButton());
      fragment.appendChild(this.createSplitRow(r5Left, r5Right));

      // Row 6: Switcher (ABC) + Actions + Space + Enter
      fragment.appendChild(this.createBottomRow(variant, 'ABC'));
    }

    const wrapper = document.createElement('div');
    wrapper.appendChild(fragment);
    return wrapper;
  }

  private createShiftButton(): HTMLElement {
    const shiftBtn = document.createElement('button');
    shiftBtn.type = 'button';
    shiftBtn.className = 'keycap key-fn key-shift';
    if (this.isCapsLock) shiftBtn.classList.add('caps-locked');
    else if (this.isShiftActive) shiftBtn.classList.add('shift-active');

    shiftBtn.innerHTML = `
      <span class="caps-led"></span>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="12 4 4 12 9 12 9 20 15 20 15 12 20 12 12 4"></polyline>
      </svg>
    `;
    shiftBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.handleShiftTap();
    });
    return shiftBtn;
  }

  private createBackspaceButton(): HTMLElement {
    const bkspBtn = document.createElement('button');
    bkspBtn.type = 'button';
    bkspBtn.className = 'keycap key-fn key-backspace';
    bkspBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"></path>
        <line x1="18" y1="9" x2="12" y2="15"></line>
        <line x1="12" y1="9" x2="18" y2="15"></line>
      </svg>
    `;
    bkspBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.handleKeyPress('\x7f');
    });
    return bkspBtn;
  }

  private createBottomRow(variant: 'portrait' | 'left' | 'right', modeSwitcherLabel: string): HTMLElement {
    const r6 = document.createElement('div');
    r6.className = 'keyboard-row bottom-row';

    // Switcher button (?123 / ABC)
    const switchBtn = document.createElement('button');
    switchBtn.type = 'button';
    switchBtn.className = 'keycap key-fn key-switch';
    switchBtn.textContent = modeSwitcherLabel;
    switchBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.triggerHaptic(15);
      this.currentMode = this.currentMode === 'alpha' ? 'symbols' : 'alpha';
      this.updateMainRows();
    });

    // Native Mobile Input Method Toggle Button (Icon only)
    const imeBtn = document.createElement('button');
    imeBtn.type = 'button';
    imeBtn.className = 'keycap key-fn key-ime';
    imeBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2"></rect>
        <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"></path>
      </svg>
    `;
    imeBtn.title = '唤起系统原生输入法';
    imeBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.triggerHaptic(15);
      this.onToggleNativeIME?.();
    });

    // Spacebar with Voice Input
    const spaceKey = document.createElement('button');
    spaceKey.type = 'button';
    spaceKey.className = 'keycap key-space';
    spaceKey.innerHTML = `
      <svg class="space-mic-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
      <span>Space</span>
    `;
    spaceKey.addEventListener('pointerdown', (e) => this.handleSpacePointerDown(e, spaceKey));
    spaceKey.addEventListener('pointerup', (e) => this.handleSpacePointerUp(e, spaceKey));

    // English Dot Key [ . ]
    const dotBtn = document.createElement('button');
    dotBtn.type = 'button';
    dotBtn.className = 'keycap key-char key-dot';
    dotBtn.textContent = '.';
    dotBtn.title = '英文句点 [ . ]';
    dotBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handleCharPress('.');
    });

    // Enter Key (Icon only, prominent return symbol)
    const enterBtn = document.createElement('button');
    enterBtn.type = 'button';
    enterBtn.className = 'keycap key-fn key-enter';
    enterBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 10 4 15 9 20"></polyline>
        <path d="M20 4v7a4 4 0 0 1-4 4H4"></path>
      </svg>
    `;
    enterBtn.title = 'Enter / 回车';
    enterBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.handleKeyPress('\r');
    });

    if (variant === 'portrait') {
      const leftHalf = document.createElement('div');
      leftHalf.className = 'kb-half kb-half-left';
      leftHalf.appendChild(switchBtn);
      leftHalf.appendChild(imeBtn);

      const rightHalf = document.createElement('div');
      rightHalf.className = 'kb-half kb-half-right';
      rightHalf.appendChild(dotBtn);
      rightHalf.appendChild(enterBtn);

      r6.appendChild(leftHalf);
      r6.appendChild(spaceKey);
      r6.appendChild(rightHalf);
    } else if (variant === 'left') {
      const leftHalf = document.createElement('div');
      leftHalf.className = 'kb-half kb-half-left';
      leftHalf.appendChild(switchBtn);
      leftHalf.appendChild(imeBtn);
      leftHalf.appendChild(spaceKey);

      const rightHalf = document.createElement('div');
      rightHalf.className = 'kb-half kb-half-right';
      rightHalf.appendChild(dotBtn);
      rightHalf.appendChild(enterBtn);

      r6.appendChild(leftHalf);
      r6.appendChild(rightHalf);
    } else {
      // variant === 'right'
      const leftHalf = document.createElement('div');
      leftHalf.className = 'kb-half kb-half-left';
      leftHalf.appendChild(switchBtn);
      leftHalf.appendChild(imeBtn);

      const rightHalf = document.createElement('div');
      rightHalf.className = 'kb-half kb-half-right';
      rightHalf.appendChild(spaceKey);
      rightHalf.appendChild(dotBtn);
      rightHalf.appendChild(enterBtn);

      r6.appendChild(leftHalf);
      r6.appendChild(rightHalf);
    }

    return r6;
  }

  private createCharKey(char: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'keycap key-char';
    btn.textContent = char;

    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handleCharPress(char);
    });

    return btn;
  }

  private handleCharPress(char: string): void {
    const now = Date.now();
    // Filter out synthetic duplicate pointer/touch events within 75ms
    if (char === this.lastInputValue && now - this.lastInputTime < 75) {
      return;
    }
    this.lastInputTime = now;
    this.lastInputValue = char;

    this.triggerHaptic(15);

    if (this.ctrlLatched) {
      // Ctrl + Key combination
      const lower = char.toLowerCase();
      const code = lower.charCodeAt(0);
      let output = char;

      if (code >= 97 && code <= 122) {
        // 'a' -> 1 (\x01), 'c' -> 3 (\x03), etc.
        output = String.fromCharCode(code - 96);
      }
      this.onInput(output);
      this.toggleCtrlLatch(false);
    } else {
      this.onInput(char);
      // If Shift was active (not caps lock), reset shift
      if (this.isShiftActive && !this.isCapsLock) {
        this.isShiftActive = false;
        this.updateMainRows();
      }
    }
  }

  private handleKeyPress(val: string): void {
    const now = Date.now();
    // Filter out synthetic duplicate pointer/touch events within 75ms
    if (val === this.lastInputValue && now - this.lastInputTime < 75) {
      return;
    }
    this.lastInputTime = now;
    this.lastInputValue = val;

    this.triggerHaptic(15);

    if (this.ctrlLatched) {
      this.toggleCtrlLatch(false);
    }

    this.onInput(val);
  }

  private toggleCtrlLatch(force?: boolean): void {
    this.triggerHaptic(20);
    this.ctrlLatched = force !== undefined ? force : !this.ctrlLatched;

    this.container.querySelectorAll('.key-ctrl').forEach((ctrlBtn) => {
      ctrlBtn.classList.toggle('latched', this.ctrlLatched);
    });
  }

  private handleShiftTap(): void {
    const now = Date.now();
    const isDoubleTap = now - this.lastShiftClickTime < 300;
    this.lastShiftClickTime = now;
    this.triggerHaptic(20);

    if (this.isCapsLock) {
      this.isCapsLock = false;
      this.isShiftActive = false;
    } else if (isDoubleTap) {
      this.isCapsLock = true;
      this.isShiftActive = true;
    } else {
      this.isShiftActive = !this.isShiftActive;
    }

    this.updateMainRows();
  }

  private startKeyRepeat(val: string): void {
    this.handleKeyPress(val);

    this.repeatTimer = setTimeout(() => {
      this.repeatInterval = setInterval(() => {
        this.handleKeyPress(val);
      }, 70);
    }, 350);
  }

  private stopKeyRepeat(): void {
    if (this.repeatTimer) {
      clearTimeout(this.repeatTimer);
      this.repeatTimer = null;
    }
    if (this.repeatInterval) {
      clearInterval(this.repeatInterval);
      this.repeatInterval = null;
    }
  }

  // --- Voice Input (ASR) Implementation via SpeechManager ---

  private handleSpacePointerDown(e: PointerEvent, keyEl: HTMLElement): void {
    e.preventDefault();
    this.voiceStartY = e.clientY;
    this.isVoiceCancelled = false;
    this.isVoiceRecording = false;
    keyEl.classList.add('space-active');

    this.voicePressTimer = setTimeout(async () => {
      // Long press (>= 400ms) -> Activate ASR
      this.isVoiceRecording = true;
      this.triggerHaptic(30);

      try {
        const recorder = await this.speechManager.start();
        this.voiceHUD.show(recorder);
      } catch (err: any) {
        console.error('[VirtualKeyboard] Failed to start microphone:', err);
        alert('无法访问麦克风，请检查浏览器权限。');
        this.isVoiceRecording = false;
        keyEl.classList.remove('space-active');
      }
    }, 400);
  }

  private handleSpacePointerUp(e: PointerEvent, keyEl: HTMLElement): void {
    e.preventDefault();
    keyEl.classList.remove('space-active');

    if (this.voicePressTimer) {
      clearTimeout(this.voicePressTimer);
      this.voicePressTimer = null;
    }

    if (!this.isVoiceRecording) {
      // Short tap (< 400ms) -> Ordinary Space
      this.handleKeyPress(' ');
      return;
    }

    // Voice recording ends
    this.finishVoiceRecording();
  }

  private handleGlobalPointerMove(e: PointerEvent): void {
    if (!this.isVoiceRecording) return;

    const deltaY = this.voiceStartY - e.clientY;
    if (deltaY > 50) {
      // Swiped up > 50px -> Cancel mode
      if (!this.isVoiceCancelled) {
        this.isVoiceCancelled = true;
        this.voiceHUD.setState('cancel');
        this.triggerHaptic(15);
      }
    } else {
      // Restored below threshold
      if (this.isVoiceCancelled) {
        this.isVoiceCancelled = false;
        this.voiceHUD.setState('listening');
      }
    }
  }

  private async finishVoiceRecording(): Promise<void> {
    this.isVoiceRecording = false;

    if (this.isVoiceCancelled) {
      console.log('[VirtualKeyboard] Voice input cancelled by user swipe');
      this.speechManager.cancel();
      this.voiceHUD.hide();
      return;
    }

    this.voiceHUD.setState('processing');

    try {
      const text = await this.speechManager.stop();
      if (text) {
        console.log(`[VirtualKeyboard] ASR recognized text: "${text}"`);
        this.onInput(text);
      }
    } catch (err: any) {
      console.error('[VirtualKeyboard] Voice recognition error:', err);
    } finally {
      this.voiceHUD.hide();
    }
  }

  private handleGlobalPointerUp(): void {
    this.stopKeyRepeat();

    if (this.isVoiceRecording) {
      this.finishVoiceRecording();
    } else if (this.voicePressTimer) {
      clearTimeout(this.voicePressTimer);
      this.voicePressTimer = null;
    }

    const spaceActive = this.container.querySelectorAll('.space-active');
    spaceActive.forEach((el) => el.classList.remove('space-active'));
  }
}
