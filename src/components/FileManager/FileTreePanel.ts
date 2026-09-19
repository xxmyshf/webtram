import { FileEntry, ListDirResult } from './types.js';

export interface FileTreeCallbacks {
  onNavigate: (path: string) => void;
  onSelectFile: (file: FileEntry) => void;
  onFilesDropped: (files: FileList, targetDir: string) => void;
}

export class FileTreePanel {
  private container: HTMLElement;
  private callbacks: FileTreeCallbacks;
  private currentResult: ListDirResult | null = null;
  private selectedItem: FileEntry | null = null;
  private filterQuery = '';
  private showHidden = true;

  constructor(callbacks: FileTreeCallbacks) {
    this.callbacks = callbacks;
    this.container = document.createElement('div');
    this.container.className = 'file-tree-panel';
    this.render();
  }

  public getElement(): HTMLElement {
    return this.container;
  }

  public getSelectedItem(): FileEntry | null {
    return this.selectedItem;
  }

  public getCurrentPath(): string {
    return this.currentResult?.currentPath || '';
  }

  public updateData(result: ListDirResult): void {
    this.currentResult = result;
    this.render();
  }

  public clearSelection(): void {
    this.selectedItem = null;
    this.container.querySelectorAll('.file-row-selected').forEach((el) => el.classList.remove('file-row-selected'));
  }

  private render(): void {
    if (!this.currentResult) {
      this.container.innerHTML = `
        <div class="tree-loading">
          <span class="cyber-spinner"></span>
          <span>正在扫描文件树...</span>
        </div>
      `;
      return;
    }

    const { currentPath, parentPath, entries } = this.currentResult;
    const filtered = entries.filter((e) => {
      if (!this.filterQuery) return true;
      return e.name.toLowerCase().includes(this.filterQuery.toLowerCase());
    });

    const breadcrumbs = this.buildBreadcrumbs(currentPath);

    this.container.innerHTML = `
      <!-- Breadcrumb Bar -->
      <div class="tree-breadcrumb-bar">
        <button type="button" class="btn-crumb-root" data-path="/" title="根目录 /">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
            <polyline points="9 22 9 12 15 12 15 22"></polyline>
          </svg>
        </button>
        <div class="breadcrumb-scroll">${breadcrumbs}</div>
      </div>

      <!-- Search & Options Bar -->
      <div class="tree-search-bar">
        <div class="search-input-wrap">
          <svg class="search-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input type="text" class="tree-filter-input" placeholder="过滤当前目录文件..." value="${this.escapeHtml(this.filterQuery)}" />
          ${this.filterQuery ? `<button type="button" class="btn-clear-filter">×</button>` : ''}
        </div>
        <button type="button" class="cyber-btn-mini btn-toggle-hidden ${this.showHidden ? 'active' : ''}" title="显示/隐藏隐藏文件">
          ${this.showHidden ? '隐:开' : '隐:关'}
        </button>
      </div>

      <!-- File List Container -->
      <div class="tree-list-wrapper" id="tree-drop-zone">
        <div class="tree-list-header">
          <span class="col-name">名称</span>
          <span class="col-size">大小</span>
          <span class="col-time">修改时间</span>
        </div>
        <div class="tree-list-body">
          ${parentPath ? `
            <div class="file-row parent-row" data-path="${this.escapeHtml(parentPath)}" title="返回上级目录">
              <span class="col-name">
                <span class="row-icon">📁</span>
                <span class="row-name">.. (上级目录)</span>
              </span>
              <span class="col-size">-</span>
              <span class="col-time">-</span>
            </div>
          ` : ''}

          ${filtered.length === 0 ? `
            <div class="tree-empty-notice">目录为空或未匹配到文件</div>
          ` : filtered.map((item) => {
            const isSelected = this.selectedItem && this.selectedItem.path === item.path;
            const ext = item.extension;
            const icon = item.isDirectory ? '📁' : this.getFileIcon(ext);
            const sizeStr = item.isDirectory ? '-' : this.formatSize(item.size);
            const dateStr = this.formatDate(item.mtime);

            return `
              <div class="file-row ${item.isDirectory ? 'dir-row' : 'item-row'} ${isSelected ? 'file-row-selected' : ''}" data-path="${this.escapeHtml(item.path)}">
                <span class="col-name" title="${this.escapeHtml(item.name)}">
                  <span class="row-icon">${icon}</span>
                  <span class="row-name">${this.escapeHtml(item.name)}</span>
                </span>
                <span class="col-size">${sizeStr}</span>
                <span class="col-time">${dateStr}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private buildBreadcrumbs(currentPath: string): string {
    const parts = currentPath.split('/').filter(Boolean);
    let accum = '';
    let html = '';

    parts.forEach((p, idx) => {
      accum += '/' + p;
      const isLast = idx === parts.length - 1;
      html += `
        <span class="crumb-sep">/</span>
        <button type="button" class="crumb-item ${isLast ? 'crumb-active' : ''}" data-path="${this.escapeHtml(accum)}">
          ${this.escapeHtml(p)}
        </button>
      `;
    });

    return html;
  }

  private bindEvents(): void {
    // Breadcrumbs
    this.container.querySelectorAll<HTMLButtonElement>('.crumb-item, .btn-crumb-root').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = btn.getAttribute('data-path');
        if (p) this.callbacks.onNavigate(p);
      });
    });

    // Filter input
    const filterInput = this.container.querySelector<HTMLInputElement>('.tree-filter-input');
    if (filterInput) {
      filterInput.addEventListener('input', () => {
        this.filterQuery = filterInput.value;
        this.render();
      });
    }

    const clearFilterBtn = this.container.querySelector<HTMLButtonElement>('.btn-clear-filter');
    if (clearFilterBtn) {
      clearFilterBtn.addEventListener('click', () => {
        this.filterQuery = '';
        this.render();
      });
    }

    // Toggle hidden
    const btnHidden = this.container.querySelector<HTMLButtonElement>('.btn-toggle-hidden');
    if (btnHidden) {
      btnHidden.addEventListener('click', () => {
        this.showHidden = !this.showHidden;
        if (this.currentResult) {
          this.callbacks.onNavigate(this.currentResult.currentPath);
        }
      });
    }

    // Parent dir click
    this.container.querySelector('.parent-row')?.addEventListener('click', () => {
      if (this.currentResult?.parentPath) {
        this.callbacks.onNavigate(this.currentResult.parentPath);
      }
    });

    // File/Directory row clicks
    this.container.querySelectorAll<HTMLElement>('.file-row:not(.parent-row)').forEach((row) => {
      const p = row.getAttribute('data-path');
      const item = this.currentResult?.entries.find((e) => e.path === p);
      if (!item) return;

      // Click: select item
      row.addEventListener('click', () => {
        this.selectedItem = item;
        this.container.querySelectorAll('.file-row-selected').forEach((el) => el.classList.remove('file-row-selected'));
        row.classList.add('file-row-selected');

        if (!item.isDirectory) {
          this.callbacks.onSelectFile(item);
        }
      });

      // Double click: open folder
      if (item.isDirectory) {
        row.addEventListener('dblclick', () => {
          this.callbacks.onNavigate(item.path);
        });
      }
    });

    // Drag and Drop Upload onto list
    const dropZone = this.container.querySelector<HTMLElement>('#tree-drop-zone');
    if (dropZone && this.currentResult) {
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drop-target-active');
      });

      dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drop-target-active');
      });

      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drop-target-active');
        if (e.dataTransfer && e.dataTransfer.files.length > 0) {
          this.callbacks.onFilesDropped(e.dataTransfer.files, this.currentResult!.currentPath);
        }
      });
    }
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  private formatDate(ms: number): string {
    const d = new Date(ms);
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    const h = d.getHours().toString().padStart(2, '0');
    const min = d.getMinutes().toString().padStart(2, '0');
    return `${m}-${day} ${h}:${min}`;
  }

  private getFileIcon(ext: string): string {
    if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'].includes(ext)) return '🖼️';
    if (['.mp3', '.wav', '.ogg'].includes(ext)) return '🎵';
    if (['.mp4', '.webm'].includes(ext)) return '🎬';
    if (ext === '.md') return '📝';
    if (['.ts', '.js', '.jsx', '.tsx'].includes(ext)) return '⚡';
    if (['.json', '.yml', '.yaml'].includes(ext)) return '⚙️';
    if (['.html', '.css'].includes(ext)) return '🌐';
    if (['.sh', '.bash'].includes(ext)) return '💻';
    if (['.node', '.so', '.dll', '.bin'].includes(ext)) return '📦';
    return '📄';
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
