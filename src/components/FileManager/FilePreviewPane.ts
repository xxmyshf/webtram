import { FileReadResult } from './types.js';

export interface FilePreviewCallbacks {
  onSaveFile: (path: string, content: string) => Promise<boolean>;
  getAuthPassword: () => string;
  onClosePreview?: () => void;
}

export class FilePreviewPane {
  private container: HTMLElement;
  private currentData: FileReadResult | null = null;
  private callbacks: FilePreviewCallbacks;
  private mdMode: 'rendered' | 'source' = 'rendered';
  private isEditing = false;
  private editorTextarea: HTMLTextAreaElement | null = null;

  constructor(callbacks: FilePreviewCallbacks) {
    this.callbacks = callbacks;
    this.container = document.createElement('div');
    this.container.className = 'file-preview-pane';
    this.renderEmpty();
  }

  public getElement(): HTMLElement {
    return this.container;
  }

  public render(data: FileReadResult | null): void {
    this.currentData = data;
    this.isEditing = false;

    if (!data) {
      this.renderEmpty();
      return;
    }

    const ext = this.getFileExtension(data.name);
    const isImage = this.isImageExt(ext);
    const isAudio = this.isAudioExt(ext);
    const isVideo = this.isVideoExt(ext);
    const isPdf = ext === '.pdf';
    const isMarkdown = ext === '.md';

    const authPwd = encodeURIComponent(this.callbacks.getAuthPassword());
    const rawUrl = `/api/fs/raw?path=${encodeURIComponent(data.path)}&pwd=${authPwd}`;
    const formattedSize = this.formatSize(data.size);
    const formattedDate = new Date(data.mtime).toLocaleString();

    let contentHtml = '';

    if (isImage) {
      contentHtml = `
        <div class="preview-media-wrapper image-preview-wrapper">
          <img src="${rawUrl}" alt="${this.escapeHtml(data.name)}" class="preview-image" />
        </div>
      `;
    } else if (isAudio) {
      contentHtml = `
        <div class="preview-media-wrapper audio-preview-wrapper">
          <audio controls src="${rawUrl}" class="preview-audio"></audio>
        </div>
      `;
    } else if (isVideo) {
      contentHtml = `
        <div class="preview-media-wrapper video-preview-wrapper">
          <video controls src="${rawUrl}" class="preview-video"></video>
        </div>
      `;
    } else if (isPdf) {
      contentHtml = `
        <div class="preview-media-wrapper pdf-preview-wrapper">
          <iframe src="${rawUrl}" class="preview-pdf-frame"></iframe>
        </div>
      `;
    } else if (data.isBinary) {
      contentHtml = `
        <div class="preview-binary-notice">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5">
            <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
            <polyline points="2 17 12 22 22 17"></polyline>
            <polyline points="2 12 12 17 22 12"></polyline>
          </svg>
          <div class="notice-title">检测到二进制 / 非文本数据</div>
          <div class="notice-desc">该文件不适合作为常规文本渲染。右侧已自动为您生成<b>前 300 字节 Hex Dump</b> 以及<b>可视化字节矩阵</b>。</div>
          <div class="notice-meta">特征识别: <span class="cyber-badge badge-cyan">${data.byteStats.detectedType}</span></div>
        </div>
      `;
    } else {
      // Text / Code / Markdown
      const rawText = data.textContent || '';
      if (isMarkdown && this.mdMode === 'rendered') {
        contentHtml = `
          <div class="markdown-rendered-view cyberpunk-markdown">
            ${this.renderMarkdown(rawText)}
          </div>
        `;
      } else {
        contentHtml = `
          <div class="text-editor-container">
            <div class="text-line-numbers" id="preview-line-numbers">
              ${this.buildLineNumbers(rawText)}
            </div>
            <textarea class="preview-textarea" spellcheck="false" id="preview-textarea">${this.escapeHtml(rawText)}</textarea>
          </div>
        `;
      }
    }

    this.container.innerHTML = `
      <div class="preview-header">
        <div class="preview-header-left">
          <span class="preview-file-icon">${this.getFileIcon(ext, data.isBinary)}</span>
          <div class="preview-title-meta">
            <span class="preview-file-name" title="${this.escapeHtml(data.path)}">${this.escapeHtml(data.name)}</span>
            <span class="preview-file-sub">${formattedSize} • 修改于 ${formattedDate}</span>
          </div>
        </div>
        <div class="preview-header-right">
          ${isMarkdown ? `
            <div class="md-mode-switch">
              <button type="button" class="cyber-btn-mini ${this.mdMode === 'rendered' ? 'active' : ''}" id="btn-md-rendered">渲染</button>
              <button type="button" class="cyber-btn-mini ${this.mdMode === 'source' ? 'active' : ''}" id="btn-md-source">源码</button>
            </div>
          ` : ''}
          ${!data.isBinary ? `
            <button type="button" class="cyber-btn-mini btn-save-file" id="btn-save-file" title="保存修改 (Ctrl+S)">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                <polyline points="17 21 17 13 7 13 7 21"></polyline>
                <polyline points="7 3 7 8 15 8"></polyline>
              </svg>
              <span>保存</span>
            </button>
            <button type="button" class="cyber-btn-mini btn-copy-text" id="btn-copy-text" title="复制文件内容">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>复制</span>
            </button>
          ` : ''}
          <button type="button" class="cyber-btn-mini btn-close-preview" id="btn-close-preview" title="关闭预览，返回三栏目录浏览">
            ✕ 退出预览
          </button>
        </div>
      </div>
      <div class="preview-body">
        ${contentHtml}
      </div>
    `;

    this.bindEvents();
  }

  private renderEmpty(): void {
    this.container.innerHTML = `
      <div class="preview-empty-state">
        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
        </svg>
        <span class="empty-title">常规浏览器预览区</span>
        <span class="empty-desc">在左侧目录选择文本、代码、Markdown、图片或媒体文件即可在此实时预览与轻量编辑</span>
      </div>
    `;
  }

  private bindEvents(): void {
    if (!this.currentData) return;

    // Markdown tabs
    const btnMdRendered = this.container.querySelector<HTMLButtonElement>('#btn-md-rendered');
    const btnMdSource = this.container.querySelector<HTMLButtonElement>('#btn-md-source');
    if (btnMdRendered && btnMdSource) {
      btnMdRendered.addEventListener('click', () => {
        this.mdMode = 'rendered';
        this.render(this.currentData);
      });
      btnMdSource.addEventListener('click', () => {
        this.mdMode = 'source';
        this.render(this.currentData);
      });
    }

    // Save button
    const btnSave = this.container.querySelector<HTMLButtonElement>('#btn-save-file');
    const textarea = this.container.querySelector<HTMLTextAreaElement>('#preview-textarea');
    this.editorTextarea = textarea;

    if (btnSave && textarea) {
      const handleSave = async () => {
        const newText = textarea.value;
        const originalText = btnSave.innerHTML;
        btnSave.innerHTML = `<span>保存中...</span>`;
        const success = await this.callbacks.onSaveFile(this.currentData!.path, newText);
        if (success) {
          btnSave.innerHTML = `<span>✓ 已保存</span>`;
          if (this.currentData) {
            this.currentData.textContent = newText;
            this.currentData.size = new Blob([newText]).size;
          }
          setTimeout(() => { btnSave.innerHTML = originalText; }, 1500);
        } else {
          btnSave.innerHTML = `<span>❌ 失败</span>`;
          setTimeout(() => { btnSave.innerHTML = originalText; }, 2000);
        }
      };

      btnSave.addEventListener('click', handleSave);

      // Support Ctrl+S / Cmd+S in editor
      textarea.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          handleSave();
        }
      });

      // Synchronize line numbers on typing & scroll
      const lineNumbersEl = this.container.querySelector<HTMLElement>('#preview-line-numbers');
      if (lineNumbersEl) {
        textarea.addEventListener('input', () => {
          lineNumbersEl.innerHTML = this.buildLineNumbers(textarea.value);
        });
        textarea.addEventListener('scroll', () => {
          lineNumbersEl.scrollTop = textarea.scrollTop;
        });
      }
    }

    // Copy text
    const btnCopy = this.container.querySelector<HTMLButtonElement>('#btn-copy-text');
    if (btnCopy && this.currentData && this.currentData.textContent !== undefined) {
      btnCopy.addEventListener('click', () => {
        const text = textarea ? textarea.value : this.currentData!.textContent!;
        navigator.clipboard.writeText(text).then(() => {
          const original = btnCopy.innerHTML;
          btnCopy.innerHTML = `<span>✓ 已复制</span>`;
          setTimeout(() => { btnCopy.innerHTML = original; }, 1500);
        });
      });
    }

    // Close preview
    this.container.querySelector('#btn-close-preview')?.addEventListener('click', () => {
      this.callbacks.onClosePreview?.();
    });
  }

  private buildLineNumbers(text: string): string {
    const lines = text.split('\n').length;
    let out = '';
    for (let i = 1; i <= lines; i++) {
      out += `<div>${i}</div>`;
    }
    return out;
  }

  private renderMarkdown(md: string): string {
    // 简易但轻量且安全的 Markdown 转 HTML
    let html = this.escapeHtml(md);

    // Code blocks ```...```
    html = html.replace(/```([\s\S]*?)```/g, '<pre class="md-code-block"><code>$1</code></pre>');
    // Inline code `...`
    html = html.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
    // Headers #, ##, ###
    html = html.replace(/^### (.*$)/gim, '<h3 class="md-h3">$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2 class="md-h2">$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1 class="md-h1">$1</h1>');
    // Bold **text**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic *text*
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Blockquote > text
    html = html.replace(/^\> (.*$)/gim, '<blockquote class="md-quote">$1</blockquote>');
    // Unordered list - text
    html = html.replace(/^\s*-\s+(.*$)/gim, '<li class="md-li">$1</li>');
    // Newlines to <br> if not inside pre
    html = html.replace(/\n\n/g, '<p class="md-p"></p>');

    return html;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  private getFileExtension(filename: string): string {
    const idx = filename.lastIndexOf('.');
    return idx >= 0 ? filename.substring(idx).toLowerCase() : '';
  }

  private isImageExt(ext: string): boolean {
    return ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp'].includes(ext);
  }

  private isAudioExt(ext: string): boolean {
    return ['.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a'].includes(ext);
  }

  private isVideoExt(ext: string): boolean {
    return ['.mp4', '.webm', '.ogg', '.mov', '.mkv'].includes(ext);
  }

  private getFileIcon(ext: string, isBinary: boolean): string {
    if (this.isImageExt(ext)) return '🖼️';
    if (this.isAudioExt(ext)) return '🎵';
    if (this.isVideoExt(ext)) return '🎬';
    if (ext === '.md') return '📝';
    if (['.ts', '.js', '.jsx', '.tsx'].includes(ext)) return '⚡';
    if (['.json', '.yml', '.yaml'].includes(ext)) return '⚙️';
    if (['.html', '.css', '.vue'].includes(ext)) return '🌐';
    if (['.sh', '.bash', '.zsh'].includes(ext)) return '💻';
    if (isBinary) return '📦';
    return '📄';
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
