export interface NativeIMEBridgeOptions {
  onInput: (data: string) => void;
  onActivate?: () => void;
  onDeactivate?: () => void;
}

export class NativeIMEBridge {
  private inputEl: HTMLTextAreaElement;
  private bannerEl: HTMLElement;
  private onInput: (data: string) => void;
  private onActivate?: () => void;
  private onDeactivate?: () => void;
  private isActive = false;
  private isComposing = false;

  constructor(options: NativeIMEBridgeOptions) {
    this.onInput = options.onInput;
    this.onActivate = options.onActivate;
    this.onDeactivate = options.onDeactivate;

    // Create transparent input element for mobile native IME
    this.inputEl = document.createElement('textarea');
    this.inputEl.className = 'native-ime-hidden-input';
    this.inputEl.style.display = 'none';
    this.inputEl.setAttribute('readonly', 'true');
    this.inputEl.setAttribute('inputmode', 'none');
    this.inputEl.setAttribute('tabindex', '-1');
    this.inputEl.setAttribute('autocomplete', 'off');
    this.inputEl.setAttribute('autocorrect', 'off');
    this.inputEl.setAttribute('autocapitalize', 'off');
    this.inputEl.setAttribute('spellcheck', 'false');

    // Create minimal "退出输入法 + 关闭图标" floating action bar
    this.bannerEl = document.createElement('div');
    this.bannerEl.className = 'native-ime-banner hidden';
    this.bannerEl.title = '点击退出手机原生输入法';
    this.bannerEl.innerHTML = `
      <span class="native-ime-text">退出输入法</span>
      <svg class="native-ime-close-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;

    document.body.appendChild(this.inputEl);
    document.body.appendChild(this.bannerEl);

    this.bindEvents();
  }

  public activate(): void {
    if (this.isActive) return;
    this.isActive = true;
    this.bannerEl.classList.remove('hidden');
    this.inputEl.value = '';
    this.inputEl.style.display = 'block';
    this.inputEl.removeAttribute('readonly');
    this.inputEl.setAttribute('inputmode', 'text');

    // Notify caller to hide virtual keyboard and resize terminal
    this.onActivate?.();

    // Focus input so OS opens native keyboard
    setTimeout(() => {
      this.inputEl.focus();
    }, 50);
  }

  public deactivate(): void {
    if (!this.isActive) return;
    this.isActive = false;
    this.bannerEl.classList.add('hidden');
    this.inputEl.blur();
    this.inputEl.value = '';
    this.inputEl.setAttribute('readonly', 'true');
    this.inputEl.setAttribute('inputmode', 'none');
    this.inputEl.style.display = 'none';

    // Notify caller to restore virtual keyboard
    this.onDeactivate?.();
  }

  public toggle(): void {
    if (this.isActive) {
      this.deactivate();
    } else {
      this.activate();
    }
  }

  public getIsActive(): boolean {
    return this.isActive;
  }

  private bindEvents(): void {
    // Clicking the banner exits native IME
    this.bannerEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.deactivate();
    });

    this.inputEl.addEventListener('compositionstart', () => {
      if (!this.isActive) return;
      this.isComposing = true;
    });

    this.inputEl.addEventListener('compositionend', (e) => {
      if (!this.isActive) return;
      this.isComposing = false;
      const data = (e as any).data || this.inputEl.value;
      if (data) {
        this.onInput(data);
        this.inputEl.value = '';
      }
    });

    this.inputEl.addEventListener('input', (e: any) => {
      if (!this.isActive || this.isComposing) return;

      const inputType = e.inputType;
      if (inputType === 'deleteContentBackward') {
        this.onInput('\x7f');
      } else if (e.data) {
        this.onInput(e.data);
      } else if (this.inputEl.value) {
        this.onInput(this.inputEl.value);
      }
      this.inputEl.value = '';
    });

    this.inputEl.addEventListener('keydown', (e) => {
      if (!this.isActive || this.isComposing) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        this.onInput('\r');
        this.inputEl.value = '';
      } else if (e.key === 'Backspace' && !this.inputEl.value) {
        this.onInput('\x7f');
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.onInput('\t');
      }
    });

    this.inputEl.addEventListener('blur', () => {
      // If focus lost, delay check
      setTimeout(() => {
        if (this.isActive && document.activeElement !== this.inputEl) {
          this.deactivate();
        }
      }, 300);
    });
  }
}
