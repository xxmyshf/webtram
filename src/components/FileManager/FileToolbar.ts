import { FileEntry } from './types.js';

export interface FileToolbarCallbacks {
  onCreateFile: () => void;
  onCreateDir: () => void;
  onRename: (item: FileEntry) => void;
  onDelete: (item: FileEntry) => void;
  onUpload: () => void;
  onDownload: (item: FileEntry) => void;
  onCopyPath: (item: FileEntry | null) => void;
  onRefresh: () => void;
  onOpenInTerminal: (dirPath: string) => void;
}

export class FileToolbar {
  private container: HTMLElement;
  private callbacks: FileToolbarCallbacks;
  private currentDir = '';
  private selectedItem: FileEntry | null = null;

  constructor(callbacks: FileToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = document.createElement('div');
    this.container.className = 'file-toolbar';
    this.render();
  }

  public getElement(): HTMLElement {
    return this.container;
  }

  public updateContext(currentDir: string, selectedItem: FileEntry | null): void {
    this.currentDir = currentDir;
    this.selectedItem = selectedItem;
    this.updateButtonStates();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="toolbar-group">
        <button type="button" class="cyber-tool-btn btn-new-file" title="新建文件 (Alt+N)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="12" y1="18" x2="12" y2="12"></line>
            <line x1="9" y1="15" x2="15" y2="15"></line>
          </svg>
          <span>+文件</span>
        </button>
        <button type="button" class="cyber-tool-btn btn-new-dir" title="新建文件夹">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            <line x1="12" y1="11" x2="12" y2="17"></line>
            <line x1="9" y1="14" x2="15" y2="14"></line>
          </svg>
          <span>+目录</span>
        </button>
        <button type="button" class="cyber-tool-btn btn-upload" title="上传文件到当前目录">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
          <span>上传</span>
        </button>
      </div>

      <div class="toolbar-sep"></div>

      <div class="toolbar-group">
        <button type="button" class="cyber-tool-btn btn-rename disabled" id="btn-rename" title="重命名选中项">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
          </svg>
          <span>重命名</span>
        </button>
        <button type="button" class="cyber-tool-btn btn-delete btn-danger disabled" id="btn-delete" title="删除选中项">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
          <span>删除</span>
        </button>
        <button type="button" class="cyber-tool-btn btn-download disabled" id="btn-download" title="下载选中文件">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>下载</span>
        </button>
      </div>

      <div class="toolbar-sep"></div>

      <div class="toolbar-group">
        <button type="button" class="cyber-tool-btn btn-copy-path" title="复制当前目录或选中项路径">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span>复制路径</span>
        </button>
        <button type="button" class="cyber-tool-btn btn-open-term" title="在活跃终端中打开此目录 (cd 并切到终端)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="4 17 10 11 4 5"></polyline>
            <line x1="12" y1="19" x2="20" y2="19"></line>
          </svg>
          <span>终端打开</span>
        </button>
        <button type="button" class="cyber-tool-btn btn-refresh" title="刷新目录">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"></polyline>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
          </svg>
          <span>刷新</span>
        </button>
      </div>
    `;

    this.bindEvents();
  }

  private updateButtonStates(): void {
    const hasSelected = !!this.selectedItem;
    const isFile = hasSelected && !this.selectedItem!.isDirectory;

    const renameBtn = this.container.querySelector<HTMLButtonElement>('#btn-rename');
    const deleteBtn = this.container.querySelector<HTMLButtonElement>('#btn-delete');
    const downloadBtn = this.container.querySelector<HTMLButtonElement>('#btn-download');

    if (renameBtn) {
      if (hasSelected) renameBtn.classList.remove('disabled');
      else renameBtn.classList.add('disabled');
    }
    if (deleteBtn) {
      if (hasSelected) deleteBtn.classList.remove('disabled');
      else deleteBtn.classList.add('disabled');
    }
    if (downloadBtn) {
      if (isFile) downloadBtn.classList.remove('disabled');
      else downloadBtn.classList.add('disabled');
    }
  }

  private bindEvents(): void {
    this.container.querySelector('.btn-new-file')?.addEventListener('click', () => this.callbacks.onCreateFile());
    this.container.querySelector('.btn-new-dir')?.addEventListener('click', () => this.callbacks.onCreateDir());
    this.container.querySelector('.btn-upload')?.addEventListener('click', () => this.callbacks.onUpload());

    this.container.querySelector('#btn-rename')?.addEventListener('click', () => {
      if (this.selectedItem) this.callbacks.onRename(this.selectedItem);
    });

    this.container.querySelector('#btn-delete')?.addEventListener('click', () => {
      if (this.selectedItem) this.callbacks.onDelete(this.selectedItem);
    });

    this.container.querySelector('#btn-download')?.addEventListener('click', () => {
      if (this.selectedItem && !this.selectedItem.isDirectory) {
        this.callbacks.onDownload(this.selectedItem);
      }
    });

    this.container.querySelector('.btn-copy-path')?.addEventListener('click', () => {
      this.callbacks.onCopyPath(this.selectedItem);
    });

    this.container.querySelector('.btn-open-term')?.addEventListener('click', () => {
      const targetDir = this.selectedItem?.isDirectory ? this.selectedItem.path : this.currentDir;
      this.callbacks.onOpenInTerminal(targetDir);
    });

    this.container.querySelector('.btn-refresh')?.addEventListener('click', () => {
      this.callbacks.onRefresh();
    });
  }
}
