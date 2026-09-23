export interface AuthModalCallbacks {
  onSubmit: (password: string) => Promise<boolean>;
}

export class AuthModal {
  private container: HTMLElement;
  private inputEl: HTMLInputElement;
  private errorMsgEl: HTMLElement;
  private submitBtn: HTMLButtonElement;
  private callbacks: AuthModalCallbacks;

  constructor(callbacks: AuthModalCallbacks) {
    this.callbacks = callbacks;
    this.container = document.createElement('div');
    this.container.className = 'cyber-auth-overlay hidden';
    this.container.innerHTML = `
      <div class="auth-dialog-card">
        <div class="card-glitch-border"></div>
        <div class="auth-header">
          <div class="auth-shield-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              <circle cx="12" cy="11" r="2"></circle>
              <line x1="12" y1="13" x2="12" y2="16"></line>
            </svg>
          </div>
          <h2 class="auth-title">SYSTEM AUTHENTICATION</h2>
          <p class="auth-subtitle">TERMINAL ACCESS RESTRICTED</p>
        </div>

        <form class="auth-form" onsubmit="return false;">
          <div class="auth-field">
            <label for="auth-pwd-input">ENTER ACCESS KEY / PASSWORD</label>
            <div class="input-wrapper">
              <input type="password" id="auth-pwd-input" placeholder="输入访问密码 (默认: 12345678)" autocomplete="current-password" />
              <button type="button" class="btn-toggle-eye" title="显示/隐藏密码">
                <svg class="eye-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </button>
            </div>
            <div class="auth-error-msg"></div>
          </div>

          <button type="submit" class="auth-submit-btn">
            <span class="btn-text">INITIALIZE LINK</span>
            <span class="btn-glow"></span>
          </button>
        </form>

        <div class="auth-footer">
          <span>SECURE PTY TUNNEL // 256-BIT ENCRYPTED</span>
        </div>
      </div>
    `;

    this.inputEl = this.container.querySelector('#auth-pwd-input')!;
    this.errorMsgEl = this.container.querySelector('.auth-error-msg')!;
    this.submitBtn = this.container.querySelector('.auth-submit-btn')!;

    // Input element focus on click
    this.inputEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.inputEl.focus();
    });

    // Toggle password eye
    const eyeBtn = this.container.querySelector('.btn-toggle-eye')!;
    eyeBtn.addEventListener('click', () => {
      this.inputEl.type = this.inputEl.type === 'password' ? 'text' : 'password';
    });

    // Form submit
    const form = this.container.querySelector('.auth-form')!;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSubmit();
    });

    document.body.appendChild(this.container);
  }

  public show(reset = true): void {
    this.container.classList.remove('hidden');
    if (reset) {
      this.inputEl.value = '';
      this.errorMsgEl.textContent = '';
    }
    setTimeout(() => {
      this.inputEl.focus();
      if (!reset && this.inputEl.value) {
        this.inputEl.select();
      }
    }, 100);
  }

  public hide(): void {
    try {
      this.inputEl.blur();
    } catch {}
    this.container.classList.add('hidden');
  }

  public showError(msg: string): void {
    this.errorMsgEl.textContent = msg;
    const card = this.container.querySelector('.auth-dialog-card');
    if (card) {
      card.classList.remove('shake');
      void (card as HTMLElement).offsetWidth; // trigger reflow
      card.classList.add('shake');
    }
  }

  private async handleSubmit(): Promise<void> {
    const password = this.inputEl.value.trim();
    if (!password) {
      this.showError('请输入访问密码');
      return;
    }

    this.submitBtn.disabled = true;
    this.submitBtn.classList.add('loading');
    this.errorMsgEl.textContent = '';

    try {
      const ok = await this.callbacks.onSubmit(password);
      if (ok) {
        this.hide();
      } else {
        this.showError('密码错误，请重新输入');
        this.inputEl.focus();
        this.inputEl.select();
      }
    } catch (err: any) {
      this.showError(err.message || '网络连接失败');
    } finally {
      this.submitBtn.disabled = false;
      this.submitBtn.classList.remove('loading');
    }
  }
}
