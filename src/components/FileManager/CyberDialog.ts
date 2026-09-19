/**
 * CyberDialog & Toast Module
 * 统一提供符合赛博朋克风格的模态弹窗（确认框、输入框）与浮动通知（Toast），
 * 杜绝使用浏览器原生的 alert()、confirm() 和 prompt()。
 */

export type ToastType = 'info' | 'success' | 'warning' | 'error';

let toastContainer: HTMLElement | null = null;

function ensureToastContainer(): HTMLElement {
  if (!toastContainer || !document.body.contains(toastContainer)) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'cyber-toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

export function cyberToast(message: string, type: ToastType = 'info', duration = 2500): void {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `cyber-toast toast-${type}`;

  const iconMap: Record<ToastType, string> = {
    info: 'ℹ️',
    success: '✓',
    warning: '⚠️',
    error: '✕'
  };

  toast.innerHTML = `
    <span class="toast-icon">${iconMap[type]}</span>
    <span class="toast-msg">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('toast-show');
  });

  setTimeout(() => {
    toast.classList.remove('toast-show');
    toast.classList.add('toast-hide');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, duration);
}

export interface CyberConfirmOptions {
  title: string;
  message: string;
  targets?: string[];
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
}

export function cyberConfirm(options: CyberConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const {
      title,
      message,
      targets = [],
      confirmText = '确定',
      cancelText = '取消',
      isDanger = false
    } = options;

    const overlay = document.createElement('div');
    overlay.className = 'cyber-modal-overlay';

    let targetsHtml = '';
    if (targets.length > 0) {
      targetsHtml = `
        <div class="modal-targets-list">
          ${targets.map((t) => `<div class="target-item" title="${escapeHtml(t)}"><code>${escapeHtml(t)}</code></div>`).join('')}
        </div>
      `;
    }

    overlay.innerHTML = `
      <div class="cyber-modal-card ${isDanger ? 'modal-danger' : ''}">
        <div class="modal-header">
          <span class="modal-title">${escapeHtml(title)}</span>
          <button type="button" class="modal-close-btn">&times;</button>
        </div>
        <div class="modal-body">
          <div class="modal-message">${escapeHtml(message)}</div>
          ${targetsHtml}
        </div>
        <div class="modal-footer">
          <button type="button" class="cyber-modal-btn btn-cancel">${escapeHtml(cancelText)}</button>
          <button type="button" class="cyber-modal-btn ${isDanger ? 'btn-confirm-danger' : 'btn-confirm'}">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = (result: boolean) => {
      overlay.classList.remove('modal-overlay-show');
      window.removeEventListener('keydown', handleKey);
      setTimeout(() => {
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
        resolve(result);
      }, 150);
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        close(true);
      }
    };

    window.addEventListener('keydown', handleKey);

    overlay.querySelector('.modal-close-btn')?.addEventListener('click', () => close(false));
    overlay.querySelector('.btn-cancel')?.addEventListener('click', () => close(false));
    overlay.querySelector('.btn-confirm, .btn-confirm-danger')?.addEventListener('click', () => close(true));

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });

    requestAnimationFrame(() => {
      overlay.classList.add('modal-overlay-show');
      (overlay.querySelector('.btn-confirm, .btn-confirm-danger') as HTMLElement)?.focus();
    });
  });
}

export interface CyberPromptOptions {
  title: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
}

export function cyberPrompt(options: CyberPromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const {
      title,
      placeholder = '',
      defaultValue = '',
      confirmText = '确定',
      cancelText = '取消'
    } = options;

    const overlay = document.createElement('div');
    overlay.className = 'cyber-modal-overlay';

    overlay.innerHTML = `
      <div class="cyber-modal-card">
        <div class="modal-header">
          <span class="modal-title">${escapeHtml(title)}</span>
          <button type="button" class="modal-close-btn">&times;</button>
        </div>
        <div class="modal-body">
          <input type="text" class="cyber-modal-input" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(defaultValue)}" />
        </div>
        <div class="modal-footer">
          <button type="button" class="cyber-modal-btn btn-cancel">${escapeHtml(cancelText)}</button>
          <button type="button" class="cyber-modal-btn btn-confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const input = overlay.querySelector('.cyber-modal-input') as HTMLInputElement;

    const close = (val: string | null) => {
      overlay.classList.remove('modal-overlay-show');
      window.removeEventListener('keydown', handleKey);
      setTimeout(() => {
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
        resolve(val);
      }, 150);
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        close(input.value.trim());
      }
    };

    window.addEventListener('keydown', handleKey);

    overlay.querySelector('.modal-close-btn')?.addEventListener('click', () => close(null));
    overlay.querySelector('.btn-cancel')?.addEventListener('click', () => close(null));
    overlay.querySelector('.btn-confirm')?.addEventListener('click', () => close(input.value.trim()));

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });

    requestAnimationFrame(() => {
      overlay.classList.add('modal-overlay-show');
      if (input) {
        input.focus();
        input.select();
      }
    });
  });
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
