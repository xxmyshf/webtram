import { FileEntry, ClipboardState } from './types.js';

export interface FileToolbarCallbacks {
  onCreateFile: () => void;
  onCreateDir: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onUpload: () => void;
  onDownload: () => void;
  onCopyPath: () => void;
  onRefresh: () => void;
  onOpenInTerminal: () => void;
  onSelectAll?: () => void;
  onClearMultiSelect?: () => void;
}

export class FileToolbar {
  private container: HTMLElement;
  private callbacks: FileToolbarCallbacks;
  private currentDir = '';
  private selectedItems: FileEntry[] = [];
  private clipboard: ClipboardState | null = null;

  constructor(callbacks: FileToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = document.createElement('div');
    this.container.className = 'file-toolbar';
    this.render();
  }

  public getElement(): HTMLElement {
    return this.container;
  }

  public updateContext(
    currentDir: string,
    selectedItems: FileEntry[],
    clipboard: ClipboardState | null = null
  ): void {
    this.currentDir = currentDir;
    this.selectedItems = selectedItems;
    this.clipboard = clipboard;
    this.updateButtonStates();
  }

  private render(): void {
    this.container.innerHTML = `
      <!-- File Creation & Upload -->
      <div class="toolbar-group">
        <button type="button" class="cyber-tool-btn btn-new-file" title="新建文件 (Alt+N)">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="12" y1="18" x2="12" y2="12"></line>
            <line x1="9" y1="15" x2="15" y2="15"></line>
          </svg>
          <span>+文件</span>
        </button>
        <button type="button" class="cyber-tool-btn btn-new-dir" title="新建文件夹">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            <line x1="12" y1="11" x2="12" y2="17"></line>
            <line x1="9" y1="14" x2="15" y2="14"></line>
          </svg>
          <span>+目录</span>
        </button>
        <button type="button" class="cyber-tool-btn btn-upload" title="上传文件到当前目录">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
          <span>上传</span>
        </button>
      </div>

      <div class="toolbar-sep"></div>

      <!-- High Frequency Operations -->
      <div class="toolbar-group">
        <button type="button" class="cyber-tool-btn btn-rename disabled" id="btn-rename" title="在列表中直接重命名 (F2)">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
          </svg>
          <span>重命名</span>
        </button>
        <button type="button" class="cyber-tool-btn btn-copy disabled" id="btn-copy" title="复制选中项 (Ctrl+C)">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span id="label-copy">复制</span>
        </button>
        <button type="button" class="cyber-tool-btn btn-paste disabled" id="btn-paste" title="粘贴到当前目录 (Ctrl+V)">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
          </svg>
          <span id="label-paste">粘贴</span>
        </button>
        <button type="button" class="cyber-tool-btn btn-delete btn-danger disabled" id="btn-delete" title="删除选中项">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
          <span id="label-delete">删除</span>
        </button>
        <button type="button" class="cyber-tool-btn btn-download disabled" id="btn-download" title="下载选中文件">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>下载</span>
        </button>
      </div>

      <div class="toolbar-sep"></div>

      <!-- Navigation & System -->
      <div class="toolbar-group">
        <button type="button" class="cyber-tool-btn btn-copy-path" title="复制当前目录或选中项路径">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
          </svg>
          <span>复制路径</span>
        </button>
        <button type="button" class="cyber-tool-btn btn-open-term" title="在活跃终端中打开此目录 (自动 cd)">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="4 17 10 11 4 5"></polyline>
            <line x1="12" y1="19" x2="20" y2="19"></line>
          </svg>
          <span>终端打开</span>
        </button>
        <button type="button" class="cyber-tool-btn btn-refresh" title="刷新目录">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"></polyline>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
          </svg>
          <span>刷新</span>
        </button>
      </div>

      <!-- Multi-select state banner -->
      <div class="toolbar-multi-info" id="toolbar-multi-info" style="display: none;">
        <span class="multi-count-badge" id="multi-count-text">已选 0 项</span>
        <button type="button" class="cyber-btn-mini btn-clear-multi" id="btn-clear-multi" title="取消多选">取消</button>
      </div>
    `;

    this.bindEvents();
  }

  private updateButtonStates(): void {
    const selCount = this.selectedItems.length;
    const hasSingle = selCount === 1;
    const hasAny = selCount > 0;
    const isSingleFile = hasSingle && !this.selectedItems[0].isDirectory;

    const renameBtn = this.container.querySelector<HTMLButtonElement>('#btn-rename');
    const deleteBtn = this.container.querySelector<HTMLButtonElement>('#btn-delete');
    const deleteLabel = this.container.querySelector<HTMLElement>('#label-delete');
    const copyBtn = this.container.querySelector<HTMLButtonElement>('#btn-copy');
    const copyLabel = this.container.querySelector<HTMLElement>('#label-copy');
    const pasteBtn = this.container.querySelector<HTMLButtonElement>('#btn-paste');
    const pasteLabel = this.container.querySelector<HTMLElement>('#label-paste');
    const downloadBtn = this.container.querySelector<HTMLButtonElement>('#btn-download');
    const multiInfo = this.container.querySelector<HTMLElement>('#toolbar-multi-info');
    const multiCountText = this.container.querySelector<HTMLElement>('#multi-count-text');

    // Rename is enabled only for exactly 1 item
    if (renameBtn) {
      renameBtn.classList.toggle('disabled', !hasSingle);
    }

    // Delete is enabled for 1 or more items
    if (deleteBtn) {
      deleteBtn.classList.toggle('disabled', !hasAny);
      if (deleteLabel) {
        deleteLabel.textContent = selCount > 1 ? `删除 (${selCount})` : '删除';
      }
    }

    // Copy is enabled for 1 or more items
    if (copyBtn) {
      copyBtn.classList.toggle('disabled', !hasAny);
      if (copyLabel) {
        copyLabel.textContent = selCount > 1 ? `复制 (${selCount})` : '复制';
      }
    }

    // Paste is enabled if clipboard has items
    const hasClipboard = !!this.clipboard && this.clipboard.items.length > 0;
    if (pasteBtn) {
      pasteBtn.classList.toggle('disabled', !hasClipboard);
      if (pasteLabel) {
        pasteLabel.textContent = hasClipboard ? `粘贴 (${this.clipboard!.items.length})` : '粘贴';
      }
    }

    // Download is enabled for single file
    if (downloadBtn) {
      downloadBtn.classList.toggle('disabled', !isSingleFile);
    }

    // Multi select badge
    if (multiInfo && multiCountText) {
      if (selCount > 1) {
        multiInfo.style.display = 'inline-flex';
        multiCountText.textContent = `已选 ${selCount} 项`;
      } else {
        multiInfo.style.display = 'none';
      }
    }
  }

  private bindEvents(): void {
    this.container.querySelector('.btn-new-file')?.addEventListener('click', () => this.callbacks.onCreateFile());
    this.container.querySelector('.btn-new-dir')?.addEventListener('click', () => this.callbacks.onCreateDir());
    this.container.querySelector('.btn-upload')?.addEventListener('click', () => this.callbacks.onUpload());

    this.container.querySelector('#btn-rename')?.addEventListener('click', () => {
      if (this.selectedItems.length === 1) {
        this.callbacks.onRename();
      }
    });

    this.container.querySelector('#btn-delete')?.addEventListener('click', () => {
      if (this.selectedItems.length > 0) {
        this.callbacks.onDelete();
      }
    });

    this.container.querySelector('#btn-copy')?.addEventListener('click', () => {
      if (this.selectedItems.length > 0) {
        this.callbacks.onCopy();
      }
    });

    this.container.querySelector('#btn-paste')?.addEventListener('click', () => {
      if (this.clipboard && this.clipboard.items.length > 0) {
        this.callbacks.onPaste();
      }
    });

    this.container.querySelector('#btn-download')?.addEventListener('click', () => {
      if (this.selectedItems.length === 1 && !this.selectedItems[0].isDirectory) {
        this.callbacks.onDownload();
      }
    });

    this.container.querySelector('.btn-copy-path')?.addEventListener('click', () => {
      this.callbacks.onCopyPath();
    });

    this.container.querySelector('.btn-open-term')?.addEventListener('click', () => {
      this.callbacks.onOpenInTerminal();
    });

    this.container.querySelector('.btn-refresh')?.addEventListener('click', () => {
      this.callbacks.onRefresh();
    });

    this.container.querySelector('#btn-clear-multi')?.addEventListener('click', () => {
      this.callbacks.onClearMultiSelect?.();
    });
  }
}
