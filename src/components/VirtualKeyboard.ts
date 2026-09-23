import { SpeechManager } from './SpeechManager.js';
import { VoiceInputHUD } from './VoiceInputHUD.js';

export interface VirtualKeyboardOptions {
  onInput: (data: string) => void;
  onResizeTrigger?: () => void;
  onToggleNativeIME?: () => void;
  onScrollTerminal?: (deltaY: number) => void;
  speechManager: SpeechManager;
}

export class VirtualKeyboard {
  private container: HTMLElement;
  private onInput: (data: string) => void;
  private onResizeTrigger?: () => void;
  private onToggleNativeIME?: () => void;
  private onScrollTerminal?: (deltaY: number) => void;

  // Portrait collapse state
  private isCollapsed = false;

  // Landscape individual panel collapse states
  private isLeftCollapsed = false;
  private isRightCollapsed = false;
  private edgeToggleLeft: HTMLButtonElement | null = null;
  private edgeToggleRight: HTMLButtonElement | null = null;

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
    this.onScrollTerminal = options.onScrollTerminal;
    this.speechManager = options.speechManager;

    this.voiceHUD = new VoiceInputHUD();

    this.container = document.createElement('div');
    this.container.className = 'cyber-virtual-keyboard';

    this.render();

    // Global pointerup/touchend to ensure voice/repeat touches are released even if dragged outside
    window.addEventListener('pointerup', () => this.handleGlobalPointerUp());
    window.addEventListener('pointercancel', () => this.handleGlobalPointerUp());
    window.addEventListener('touchend', () => this.handleGlobalPointerUp());
    window.addEventListener('touchcancel', () => this.handleGlobalPointerUp());
    window.addEventListener('mouseup', () => this.handleGlobalPointerUp());
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

  public flashKey(label: string): void {
    const btns = this.container.querySelectorAll<HTMLButtonElement>(`button[data-key="${label}"]`);
    btns.forEach((btn) => {
      btn.classList.add('keycap-flashing');
      setTimeout(() => {
        btn.classList.remove('keycap-flashing');
      }, 250);
    });
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

    // 3. Floating Edge Toggle Buttons (Collapse & Expand) in Landscape
    this.edgeToggleLeft = document.createElement('button');
    this.edgeToggleLeft.type = 'button';
    this.edgeToggleLeft.className = 'btn-edge-toggle toggle-left';
    this.edgeToggleLeft.title = '收起左侧键盘';
    this.edgeToggleLeft.innerHTML = `
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"></polyline>
      </svg>
    `;
    this.edgeToggleLeft.addEventListener('click', (e) => {
      e.stopPropagation();
      this.triggerButtonFlash(this.edgeToggleLeft!);
      this.toggleSplitPanelCollapse('left');
    });
    this.container.appendChild(this.edgeToggleLeft);

    this.edgeToggleRight = document.createElement('button');
    this.edgeToggleRight.type = 'button';
    this.edgeToggleRight.className = 'btn-edge-toggle toggle-right';
    this.edgeToggleRight.title = '收起右侧键盘';
    this.edgeToggleRight.innerHTML = `
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6"></polyline>
      </svg>
    `;
    this.edgeToggleRight.addEventListener('click', (e) => {
      e.stopPropagation();
      this.triggerButtonFlash(this.edgeToggleRight!);
      this.toggleSplitPanelCollapse('right');
    });
    this.container.appendChild(this.edgeToggleRight);
  }

  private triggerButtonFlash(el: HTMLElement): void {
    el.classList.add('flash-glow');
    setTimeout(() => {
      el.classList.remove('flash-glow');
    }, 120);
  }

  private triggerKeyTouchFeedback(el: HTMLElement): void {
    el.classList.add('key-active-flash');
    setTimeout(() => {
      el.classList.remove('key-active-flash');
    }, 120);
  }

  /**
   * Creates a dedicated split panel (Left or Right) for Landscape mode
   */
  private createSplitPanel(side: 'left' | 'right'): HTMLElement {
    const panel = document.createElement('div');
    panel.className = `cyber-split-panel panel-${side}`;
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
    } else {
      this.isRightCollapsed = force !== undefined ? force : !this.isRightCollapsed;
      const panel = this.container.querySelector('.panel-right') as HTMLElement;
      if (panel) panel.classList.toggle('collapsed', this.isRightCollapsed);
      appEl?.classList.toggle('is-right-collapsed', this.isRightCollapsed);
    }
    this.updateEdgeToggleIcons();
    this.triggerHaptic(15);
    setTimeout(() => this.onResizeTrigger?.(), 50);
    setTimeout(() => this.onResizeTrigger?.(), 280);
  }

  private updateEdgeToggleIcons(): void {
    if (this.edgeToggleLeft) {
      this.edgeToggleLeft.innerHTML = this.isLeftCollapsed
        ? `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`
        : `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`;
      this.edgeToggleLeft.title = this.isLeftCollapsed ? '展开左侧键盘' : '收起左侧键盘';
    }

    if (this.edgeToggleRight) {
      this.edgeToggleRight.innerHTML = this.isRightCollapsed
        ? `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`
        : `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
      this.edgeToggleRight.title = this.isRightCollapsed ? '展开右侧键盘' : '收起右侧键盘';
    }
  }

  private createKeyboardBody(variant: 'portrait' | 'left' | 'right'): HTMLElement {
    const body = document.createElement('div');
    body.className = 'keyboard-inner-body';

    // Row 1: CLI Quick Toolbar (with inline collapse button in landscape)
    body.appendChild(this.createQuickToolbar(variant));

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

  private bindKeyAction(
    btn: HTMLElement,
    isFaint: boolean,
    action: () => void,
    options?: { repeat?: boolean; repeatValue?: string }
  ): void {
    if (!isFaint) {
      // Solid / Standard Keys:
      // Touch/Click triggers IMMEDIATELY on touchstart / mousedown with 0ms delay!
      let isTouchHandled = false;

      const triggerPress = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        this.triggerKeyTouchFeedback(btn);
        if (options?.repeat) {
          this.startKeyRepeat(options.repeatValue!);
        } else {
          action();
        }
      };

      const stopPress = (e: Event) => {
        if (options?.repeat) {
          this.stopKeyRepeat();
        }
      };

      // 1. Mobile Touch (fires instantly at hardware touch interrupt, 0ms lag)
      btn.addEventListener('touchstart', (e) => {
        isTouchHandled = true;
        triggerPress(e);
      }, { passive: false });

      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        stopPress(e);
        setTimeout(() => { isTouchHandled = false; }, 150);
      }, { passive: false });

      btn.addEventListener('touchcancel', (e) => {
        stopPress(e);
        isTouchHandled = false;
      }, { passive: false });

      // 2. Desktop Pointer / Mouse
      btn.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch' || isTouchHandled) return;
        triggerPress(e);
      });

      btn.addEventListener('pointerup', (e) => {
        if (e.pointerType === 'touch') return;
        stopPress(e);
      });

      btn.addEventListener('pointercancel', (e) => {
        if (e.pointerType === 'touch') return;
        stopPress(e);
      });

      btn.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'touch') return;
        stopPress(e);
      });
    } else {
      // Faint / Transparent Keys (floating over terminal screen in landscape):
      // Must NOT trigger immediately on touch down, so screen scrolling is NEVER blocked!
      // Dragging forwards touch scroll delta to terminal; tapping without dragging triggers on release.
      let startX = 0;
      let startY = 0;
      let lastY = 0;
      let isDragging = false;
      let pointerId: number | null = null;
      let faintRepeatTimer: NodeJS.Timeout | null = null;

      btn.addEventListener('pointerdown', (e) => {
        pointerId = e.pointerId;
        startX = e.clientX;
        startY = e.clientY;
        lastY = e.clientY;
        isDragging = false;
        try {
          btn.setPointerCapture(e.pointerId);
        } catch {}

        // For repeatable keys like Backspace, if user holds without moving (>280ms), start continuous repeat
        if (options?.repeat) {
          faintRepeatTimer = setTimeout(() => {
            if (!isDragging) {
              this.triggerKeyTouchFeedback(btn);
              this.startKeyRepeat(options.repeatValue!);
            }
          }, 280);
        }
      });

      btn.addEventListener('pointermove', (e) => {
        if (pointerId !== e.pointerId) return;
        const currentY = e.clientY;
        const currentX = e.clientX;
        const dist = Math.hypot(currentX - startX, currentY - startY);

        if (!isDragging && dist > 6) {
          isDragging = true;
          if (faintRepeatTimer) {
            clearTimeout(faintRepeatTimer);
            faintRepeatTimer = null;
          }
          this.stopKeyRepeat();
        }

        if (isDragging) {
          const deltaY = currentY - lastY;
          lastY = currentY;
          this.onScrollTerminal?.(deltaY);
        }
      });

      const finish = (e: PointerEvent, cancel: boolean) => {
        if (pointerId !== e.pointerId) return;
        try {
          btn.releasePointerCapture(e.pointerId);
        } catch {}
        pointerId = null;

        if (faintRepeatTimer) {
          clearTimeout(faintRepeatTimer);
          faintRepeatTimer = null;
        }

        if (options?.repeat) {
          this.stopKeyRepeat();
        }

        if (!isDragging && !cancel) {
          this.triggerKeyTouchFeedback(btn);
          action();
        }
        isDragging = false;
      };

      btn.addEventListener('pointerup', (e) => finish(e, false));
      btn.addEventListener('pointercancel', (e) => finish(e, true));
    }
  }

  private bindFaintContainerScroll(container: HTMLElement): void {
    let pointerId: number | null = null;
    let lastY = 0;

    container.addEventListener('pointerdown', (e) => {
      if (e.target === container) {
        pointerId = e.pointerId;
        lastY = e.clientY;
        try {
          container.setPointerCapture(e.pointerId);
        } catch {}
      }
    });

    container.addEventListener('pointermove', (e) => {
      if (pointerId === e.pointerId) {
        const deltaY = e.clientY - lastY;
        lastY = e.clientY;
        this.onScrollTerminal?.(deltaY);
      }
    });

    const finish = (e: PointerEvent) => {
      if (pointerId === e.pointerId) {
        try {
          container.releasePointerCapture(e.pointerId);
        } catch {}
        pointerId = null;
      }
    };

    container.addEventListener('pointerup', finish);
    container.addEventListener('pointercancel', finish);
  }

  /**
   * Helper to construct a row with left and right halves
   */
  private createSplitRow(
    leftKeys: HTMLElement[],
    rightKeys: HTMLElement[],
    leftFaint = false,
    rightFaint = false
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'keyboard-row';

    const leftHalf = document.createElement('div');
    leftHalf.className = `kb-half kb-half-left ${leftFaint ? 'kb-faint-half' : ''}`;
    for (const k of leftKeys) leftHalf.appendChild(k);

    const rightHalf = document.createElement('div');
    rightHalf.className = `kb-half kb-half-right ${rightFaint ? 'kb-faint-half' : ''}`;
    for (const k of rightKeys) rightHalf.appendChild(k);

    if (leftFaint) this.bindFaintContainerScroll(leftHalf);
    if (rightFaint) this.bindFaintContainerScroll(rightHalf);

    row.appendChild(leftHalf);
    row.appendChild(rightHalf);
    return row;
  }

  /**
   * Row 1: CLI Quick Toolbar (symmetric, compact, zero gap)
   */
  private createQuickToolbar(variant: 'portrait' | 'left' | 'right'): HTMLElement {
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

    const leftFaint = variant === 'right';
    const rightFaint = variant === 'left';

    const leftBtns = toolsLeft.map((item) => this.createToolButton(item, leftFaint));
    const rightBtns = toolsRight.map((item) => this.createToolButton(item, rightFaint));

    const row = this.createSplitRow(leftBtns, rightBtns, leftFaint, rightFaint);
    row.classList.add('quick-toolbar');
    return row;
  }

  private createToolButton(
    item: { label: string; value?: string; special?: string; repeat?: boolean },
    isFaint = false
  ): HTMLElement {
    const keyBtn = document.createElement('button');
    keyBtn.type = 'button';
    keyBtn.className = 'keycap key-fn key-toolbar-compact';
    keyBtn.dataset.key = item.label;

    if (item.special === 'ctrl-latch') {
      keyBtn.classList.add('key-ctrl');
      if (this.ctrlLatched) keyBtn.classList.add('latched');
      keyBtn.innerHTML = `<span>^</span><span class="ctrl-indicator"></span>`;
      keyBtn.title = 'Ctrl 锁存模式';
      this.bindKeyAction(keyBtn, isFaint, () => this.toggleCtrlLatch());
    } else if (item.repeat) {
      keyBtn.textContent = item.label;
      this.bindKeyAction(keyBtn, isFaint, () => this.handleKeyPress(item.value!), {
        repeat: true,
        repeatValue: item.value!
      });
    } else {
      keyBtn.textContent = item.label;
      this.bindKeyAction(keyBtn, isFaint, () => this.handleKeyPress(item.value!));
    }

    return keyBtn;
  }

  /**
   * Creates Alpha or Symbol layout with split left/right structure
   */
  private createMainKeys(variant: 'portrait' | 'left' | 'right'): HTMLElement {
    const fragment = document.createDocumentFragment();
    const leftFaint = variant === 'right';
    const rightFaint = variant === 'left';

    if (this.currentMode === 'alpha') {
      const isUpper = this.isShiftActive || this.isCapsLock;

      // Row 2: Dedicated Numbers Row (1 2 3 4 5 | 6 7 8 9 0)
      const numLeft = ['1', '2', '3', '4', '5'].map((n) => this.createCharKey(n, leftFaint));
      const numRight = ['6', '7', '8', '9', '0'].map((n) => this.createCharKey(n, rightFaint));
      const r2 = this.createSplitRow(numLeft, numRight, leftFaint, rightFaint);
      r2.classList.add('number-row');
      fragment.appendChild(r2);

      // Row 3: Letters Q-P (q w e r t | y u i o p)
      const r3Left = ['q', 'w', 'e', 'r', 't'].map((c) => this.createCharKey(isUpper ? c.toUpperCase() : c, leftFaint));
      const r3Right = ['y', 'u', 'i', 'o', 'p'].map((c) => this.createCharKey(isUpper ? c.toUpperCase() : c, rightFaint));
      fragment.appendChild(this.createSplitRow(r3Left, r3Right, leftFaint, rightFaint));

      // Row 4: Letters A-L (a s d f g | h j k l)
      const r4Left = ['a', 's', 'd', 'f', 'g'].map((c) => this.createCharKey(isUpper ? c.toUpperCase() : c, leftFaint));
      const r4Right = ['h', 'j', 'k', 'l'].map((c) => this.createCharKey(isUpper ? c.toUpperCase() : c, rightFaint));
      fragment.appendChild(this.createSplitRow(r4Left, r4Right, leftFaint, rightFaint));

      // Row 5: Shift + Z-M + Backspace ([Shift] z x c v | b n m [Bksp])
      const r5Left = [
        this.createShiftButton(leftFaint),
        ...['z', 'x', 'c', 'v'].map((c) => this.createCharKey(isUpper ? c.toUpperCase() : c, leftFaint))
      ];
      const r5Right = [
        ...['b', 'n', 'm'].map((c) => this.createCharKey(isUpper ? c.toUpperCase() : c, rightFaint)),
        this.createBackspaceButton(rightFaint)
      ];
      fragment.appendChild(this.createSplitRow(r5Left, r5Right, leftFaint, rightFaint));

      // Row 6: Switcher (?123) + Actions + Space + Enter
      fragment.appendChild(this.createBottomRow(variant, '?123'));
    } else {
      // Symbols Mode
      // Row 2: Top Symbols (! @ # $ % | ^ & * ( ))
      const symLeft = ['!', '@', '#', '$', '%'].map((s) => this.createCharKey(s, leftFaint));
      const symRight = ['^', '&', '*', '(', ')'].map((s) => this.createCharKey(s, rightFaint));
      const r2 = this.createSplitRow(symLeft, symRight, leftFaint, rightFaint);
      r2.classList.add('symbol-row');
      fragment.appendChild(r2);

      // Row 3: Numbers row in symbols (1 2 3 4 5 | 6 7 8 9 0)
      const numLeft = ['1', '2', '3', '4', '5'].map((n) => this.createCharKey(n, leftFaint));
      const numRight = ['6', '7', '8', '9', '0'].map((n) => this.createCharKey(n, rightFaint));
      fragment.appendChild(this.createSplitRow(numLeft, numRight, leftFaint, rightFaint));

      // Row 4: Brackets & arithmetic ([ ] { } < | > _ + = \)
      const r4Left = ['[', ']', '{', '}', '<'].map((s) => this.createCharKey(s, leftFaint));
      const r4Right = ['>', '_', '+', '=', '\\'].map((s) => this.createCharKey(s, rightFaint));
      fragment.appendChild(this.createSplitRow(r4Left, r4Right, leftFaint, rightFaint));

      // Row 5: Punctuation & Backspace (: ; " ' | , . ? ` [Bksp])
      const r5Left = [':', ';', '"', "'"].map((s) => this.createCharKey(s, leftFaint));
      const r5Right = [',', '.', '?', '`'].map((s) => this.createCharKey(s, rightFaint));
      r5Right.push(this.createBackspaceButton(rightFaint));
      fragment.appendChild(this.createSplitRow(r5Left, r5Right, leftFaint, rightFaint));

      // Row 6: Switcher (ABC) + Actions + Space + Enter
      fragment.appendChild(this.createBottomRow(variant, 'ABC'));
    }

    const wrapper = document.createElement('div');
    wrapper.appendChild(fragment);
    return wrapper;
  }

  private createShiftButton(isFaint = false): HTMLElement {
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
    this.bindKeyAction(shiftBtn, isFaint, () => this.handleShiftTap());
    return shiftBtn;
  }

  private createBackspaceButton(isFaint = false): HTMLButtonElement {
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
    this.bindKeyAction(bkspBtn, isFaint, () => this.handleKeyPress('\x7f'), {
      repeat: true,
      repeatValue: '\x7f',
    });
    return bkspBtn;
  }

  private createBottomRow(variant: 'portrait' | 'left' | 'right', modeSwitcherLabel: string): HTMLElement {
    const r6 = document.createElement('div');
    r6.className = 'keyboard-row bottom-row';
    const leftFaint = variant === 'right';
    const rightFaint = variant === 'left';

    // Switcher button (?123 / ABC)
    const switchBtn = document.createElement('button');
    switchBtn.type = 'button';
    switchBtn.className = 'keycap key-fn key-switch';
    switchBtn.textContent = modeSwitcherLabel;
    this.bindKeyAction(switchBtn, leftFaint, () => {
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
    this.bindKeyAction(imeBtn, leftFaint, () => {
      this.triggerHaptic(15);
      this.onToggleNativeIME?.();
    });

    // Spacebar with Voice Input (Space is always in the solid half for split keyboards!)
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
    this.bindKeyAction(dotBtn, rightFaint, () => {
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
    this.bindKeyAction(enterBtn, rightFaint, () => {
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
      rightHalf.className = 'kb-half kb-half-right kb-faint-half';
      rightHalf.appendChild(dotBtn);
      rightHalf.appendChild(enterBtn);
      this.bindFaintContainerScroll(rightHalf);

      r6.appendChild(leftHalf);
      r6.appendChild(rightHalf);
    } else {
      // variant === 'right'
      const leftHalf = document.createElement('div');
      leftHalf.className = 'kb-half kb-half-left kb-faint-half';
      leftHalf.appendChild(switchBtn);
      leftHalf.appendChild(imeBtn);
      this.bindFaintContainerScroll(leftHalf);

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

  private createCharKey(char: string, isFaint = false): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'keycap key-char';
    btn.textContent = char;

    this.bindKeyAction(btn, isFaint, () => {
      this.handleCharPress(char);
    });

    return btn;
  }

  private handleCharPress(char: string): void {
    const now = Date.now();
    // Filter out synthetic duplicate pointer/touch events within 35ms
    if (char === this.lastInputValue && now - this.lastInputTime < 35) {
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

  private handleKeyPress(val: string, isRepeat = false): void {
    const now = Date.now();
    // Filter out synthetic duplicate pointer/touch events within 35ms (skip debounce for repeat keys)
    if (!isRepeat && val === this.lastInputValue && now - this.lastInputTime < 35) {
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
    (window as any).__webterm_ctrl_latched = this.ctrlLatched;

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
    (window as any).__webterm_shift_active = this.isShiftActive || this.isCapsLock;

    this.updateMainRows();
  }

  private startKeyRepeat(val: string): void {
    this.stopKeyRepeat();
    this.handleKeyPress(val, false);

    this.repeatTimer = setTimeout(() => {
      this.repeatInterval = setInterval(() => {
        this.handleKeyPress(val, true);
      }, 55);
    }, 280);
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
