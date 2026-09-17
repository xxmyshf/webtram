import { SpeechManager, ASRSettings } from './SpeechManager.js';

export class ASRConfigModal {
  private container: HTMLElement;
  private speechManager: SpeechManager;
  private engineSelect: HTMLSelectElement;
  private megaAsrInput: HTMLInputElement;
  private customUrlInput: HTMLInputElement;
  private customKeyInput: HTMLInputElement;
  private langSelect: HTMLSelectElement;

  constructor(speechManager: SpeechManager) {
    this.speechManager = speechManager;
    this.container = document.createElement('div');
    this.container.className = 'cyber-auth-overlay hidden';
    this.container.innerHTML = `
      <div class="auth-dialog-card asr-config-card">
        <div class="card-glitch-border"></div>
        <div class="modal-close-btn" title="关闭">&times;</div>
        <div class="auth-header">
          <div class="auth-shield-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          </div>
          <h2 class="auth-title">ASR 语音识别配置</h2>
          <p class="auth-subtitle">SPEECH-TO-TEXT ENGINE SETTINGS</p>
        </div>

        <form class="auth-form" onsubmit="return false;">
          <div class="auth-field">
            <label for="asr-engine">识别引擎 (ENGINE)</label>
            <div class="input-wrapper">
              <select id="asr-engine" class="cyber-select">
                <option value="browser">🌐 浏览器原生识别 (Web Speech API - 默认极速)</option>
                <option value="mega-asr">⚡ Mega-ASR 服务 (http://172.18.6.16:15576/asr)</option>
                <option value="custom">🛠️ 自定义云端 ASR / Whisper 端点</option>
              </select>
            </div>
          </div>

          <div class="auth-field field-mega-asr">
            <label for="asr-mega-url">MEGA-ASR 服务地址</label>
            <div class="input-wrapper">
              <input type="text" id="asr-mega-url" placeholder="/api/asr/mega-asr 或 http://172.18.6.16:15576/asr" />
            </div>
          </div>

          <div class="auth-field field-custom">
            <label for="asr-custom-url">自定义 ASR POST 地址</label>
            <div class="input-wrapper">
              <input type="text" id="asr-custom-url" placeholder="https://api.openai.com/v1/audio/transcriptions" />
            </div>
          </div>

          <div class="auth-field field-custom">
            <label for="asr-custom-key">API KEY / TOKEN (可选)</label>
            <div class="input-wrapper">
              <input type="password" id="asr-custom-key" placeholder="Bearer Token" />
            </div>
          </div>

          <div class="auth-field">
            <label for="asr-lang">默认语言 (LANGUAGE)</label>
            <div class="input-wrapper">
              <select id="asr-lang" class="cyber-select">
                <option value="zh-CN">中文 (zh-CN)</option>
                <option value="en-US">English (en-US)</option>
                <option value="ja-JP">日本語 (ja-JP)</option>
              </select>
            </div>
          </div>

          <button type="submit" class="auth-submit-btn">
            <span class="btn-text">保存并应用配置</span>
          </button>
        </form>
      </div>
    `;

    this.engineSelect = this.container.querySelector('#asr-engine')!;
    this.megaAsrInput = this.container.querySelector('#asr-mega-url')!;
    this.customUrlInput = this.container.querySelector('#asr-custom-url')!;
    this.customKeyInput = this.container.querySelector('#asr-custom-key')!;
    this.langSelect = this.container.querySelector('#asr-lang')!;

    this.container.querySelector('.modal-close-btn')!.addEventListener('click', () => {
      this.hide();
    });

    this.engineSelect.addEventListener('change', () => this.updateVisibility());

    const form = this.container.querySelector('.auth-form')!;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSave();
    });

    document.body.appendChild(this.container);
  }

  public show(): void {
    const settings = this.speechManager.getSettings();
    this.engineSelect.value = settings.engine;
    this.megaAsrInput.value = settings.megaAsrUrl;
    this.customUrlInput.value = settings.customUrl;
    this.customKeyInput.value = settings.customKey;
    this.langSelect.value = settings.lang;
    this.updateVisibility();
    this.container.classList.remove('hidden');
  }

  public hide(): void {
    this.container.classList.add('hidden');
  }

  private updateVisibility(): void {
    const engine = this.engineSelect.value;
    const megaField = this.container.querySelector('.field-mega-asr') as HTMLElement;
    const customFields = this.container.querySelectorAll('.field-custom');

    megaField.style.display = engine === 'mega-asr' ? 'block' : 'none';
    customFields.forEach((el) => {
      (el as HTMLElement).style.display = engine === 'custom' ? 'block' : 'none';
    });
  }

  private handleSave(): void {
    const newSettings: Partial<ASRSettings> = {
      engine: this.engineSelect.value as any,
      megaAsrUrl: this.megaAsrInput.value.trim() || '/api/asr/mega-asr',
      customUrl: this.customUrlInput.value.trim(),
      customKey: this.customKeyInput.value.trim(),
      lang: this.langSelect.value
    };

    this.speechManager.saveSettings(newSettings);
    alert('语音识别设置已保存！');
    this.hide();
  }
}
