import { hashPassword } from '../utils/crypto.js';

export interface PasswordChangeModalCallbacks {
  onSuccess: (newPasswordPlainOrHash: string) => void;
}

export class PasswordChangeModal {
  private container: HTMLElement;
  private currentInput: HTMLInputElement;
  private newInput: HTMLInputElement;
  private confirmInput: HTMLInputElement;
  private errorMsgEl: HTMLElement;
  private submitBtn: HTMLButtonElement;
  private callbacks: PasswordChangeModalCallbacks;

  constructor(callbacks: PasswordChangeModalCallbacks) {
    this.callbacks = callbacks;
    this.container = document.createElement('div');
    this.container.className = 'cyber-auth-overlay hidden';
    this.container.innerHTML = `
      <div class="auth-dialog-card">
        <div class="card-glitch-border"></div>
        <div class="modal-close-btn" title="关闭">&times;</div>
        <div class="auth-header">
          <div class="auth-shield-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          <h2 class="auth-title">MODIFY ACCESS KEY</h2>
          <p class="auth-subtitle">CHANGE TERMINAL PASSWORD (ENCRYPTED)</p>
        </div>

        <form class="auth-form" onsubmit="return false;">
          <div class="auth-field">
            <label for="pwd-current">CURRENT PASSWORD (当前密码)</label>
            <div class="input-wrapper">
              <input type="password" id="pwd-current" placeholder="输入当前密码" autocomplete="current-password" />
            </div>
          </div>

          <div class="auth-field">
            <label for="pwd-new">NEW PASSWORD (新密码)</label>
            <div class="input-wrapper">
              <input type="password" id="pwd-new" placeholder="输入新密码 (至少4位)" autocomplete="new-password" />
            </div>
          </div>

          <div class="auth-field">
            <label for="pwd-confirm">CONFIRM NEW PASSWORD (确认新密码)</label>
            <div class="input-wrapper">
              <input type="password" id="pwd-confirm" placeholder="再次输入新密码" autocomplete="new-password" />
            </div>
            <div class="auth-error-msg"></div>
          </div>

          <button type="submit" class="auth-submit-btn">
            <span class="btn-text">SAVE NEW ACCESS KEY</span>
          </button>
        </form>
      </div>
    `;

    this.currentInput = this.container.querySelector('#pwd-current')!;
    this.newInput = this.container.querySelector('#pwd-new')!;
    this.confirmInput = this.container.querySelector('#pwd-confirm')!;
    this.errorMsgEl = this.container.querySelector('.auth-error-msg')!;
    this.submitBtn = this.container.querySelector('.auth-submit-btn')!;

    this.container.querySelector('.modal-close-btn')!.addEventListener('click', () => {
      this.hide();
    });

    const form = this.container.querySelector('.auth-form')!;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSubmit();
    });

    document.body.appendChild(this.container);
  }

  public show(): void {
    this.container.classList.remove('hidden');
    this.currentInput.value = '';
    this.newInput.value = '';
    this.confirmInput.value = '';
    this.errorMsgEl.textContent = '';
    setTimeout(() => this.currentInput.focus(), 100);
  }

  public hide(): void {
    try {
      this.currentInput.blur();
      this.newInput.blur();
      this.confirmInput.blur();
    } catch {}
    this.container.classList.add('hidden');
  }

  public showError(msg: string): void {
    this.errorMsgEl.textContent = msg;
    const card = this.container.querySelector('.auth-dialog-card');
    if (card) {
      card.classList.remove('shake');
      void (card as HTMLElement).offsetWidth;
      card.classList.add('shake');
    }
  }

  private async handleSubmit(): Promise<void> {
    const curVal = this.currentInput.value.trim();
    const newVal = this.newInput.value.trim();
    const confirmVal = this.confirmInput.value.trim();

    if (!curVal) {
      this.showError('请输入当前密码');
      return;
    }
    if (!newVal || newVal.length < 4) {
      this.showError('新密码长度不能少于4位');
      return;
    }
    if (newVal !== confirmVal) {
      this.showError('两次输入的新密码不一致');
      return;
    }

    this.submitBtn.disabled = true;
    this.submitBtn.classList.add('loading');
    this.errorMsgEl.textContent = '';

    try {
      // Hash on frontend with SHA-256
      const currentHash = await hashPassword(curVal);
      const newHash = await hashPassword(newVal);

      const resp = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: currentHash,
          newPassword: newVal,
          newPasswordHash: newHash
        })
      });

      const data = await resp.json();
      if (!resp.ok || !data.success) {
        throw new Error(data.error || '密码修改失败');
      }

      this.callbacks.onSuccess(newVal);
      alert('密码修改成功！');
      this.hide();
    } catch (err: any) {
      this.showError(err.message || '网络请求异常');
    } finally {
      this.submitBtn.disabled = false;
      this.submitBtn.classList.remove('loading');
    }
  }
}
