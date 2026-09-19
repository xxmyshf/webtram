import { FileEntry, ListDirResult } from './types.js';

export interface DirectoryColumnCallbacks {
  onFolderClick: (folder: FileEntry) => void;
  onFileClick: (file: FileEntry, isAlreadySelected: boolean) => void;
  onCheckboxToggle: (item: FileEntry, checked: boolean) => void;
  onBatchSelect?: (items: FileEntry[], checked: boolean) => void;
  onInlineRename: (item: FileEntry, newName: string) => Promise<boolean>;
  onDropFiles: (files: FileList, targetDir: string) => void;
  onNavigateUp?: (parentPath: string) => void;
  onNavigatePath?: (path: string) => void;
}

export class DirectoryColumn {
  private container: HTMLElement;
  private callbacks: DirectoryColumnCallbacks;

  private currentData: ListDirResult | null = null;
  private selectedFilePath: string | null = null;
  private activeFolderPath: string | null = null;
  private multiSelectedPaths = new Set<string>();
  private filterQuery = '';
  private isEditingPath: string | null = null;
  private showParentDirRow = false;
  private lastClickedItem: FileEntry | null = null;

  constructor(callbacks: DirectoryColumnCallbacks, extraClassName = '') {
    this.callbacks = callbacks;
    this.container = document.createElement('div');
    this.container.className = `directory-column ${extraClassName}`.trim();
    this.render();
  }

  public getElement(): HTMLElement {
    return this.container;
  }

  public setShowParentDirRow(show: boolean): void {
    this.showParentDirRow = show;
    if (this.currentData) {
      this.render();
    }
  }

  public setData(data: ListDirResult | null): void {
    const listWrapper = this.container.querySelector('.col-list-wrapper');
    const prevScrollTop = listWrapper ? listWrapper.scrollTop : 0;
    const prevPath = this.currentData?.currentPath;

    this.currentData = data;
    this.isEditingPath = null;
    if (data?.currentPath !== prevPath) {
      this.lastClickedItem = null;
    }
    this.render();

    if (data && prevPath === data.currentPath && prevScrollTop > 0) {
      const newWrapper = this.container.querySelector('.col-list-wrapper');
      if (newWrapper) {
        newWrapper.scrollTop = prevScrollTop;
      }
    }
  }

  public getData(): ListDirResult | null {
    return this.currentData;
  }

  public getCurrentPath(): string {
    return this.currentData?.currentPath || '';
  }

  public setSelectedFile(filePath: string | null): void {
    this.selectedFilePath = filePath;
    this.updateRowSelection();
  }

  public setActiveFolder(folderPath: string | null): void {
    this.activeFolderPath = folderPath;
    this.updateRowSelection();
  }

  public setMultiSelectedPaths(paths: Set<string>): void {
    this.multiSelectedPaths = paths;
    this.updateRowSelection();
  }

  public startInlineRename(item: FileEntry): void {
    this.isEditingPath = item.path;
    this.render();

    // Focus input and select filename
    const input = this.container.querySelector<HTMLInputElement>(`.inline-rename-input[data-path="${CSS.escape(item.path)}"]`);
    if (input) {
      input.focus();
      const dotIdx = item.name.lastIndexOf('.');
      if (!item.isDirectory && dotIdx > 0) {
        input.setSelectionRange(0, dotIdx);
      } else {
        input.select();
      }
    }
  }

  public getFilteredEntries(): FileEntry[] {
    if (!this.currentData) return [];
    return this.currentData.entries.filter((e) => {
      if (!this.filterQuery) return true;
      return e.name.toLowerCase().includes(this.filterQuery.toLowerCase());
    });
  }

  private handleRangeSelect(targetItem: FileEntry): void {
    if (!this.currentData) return;

    const filtered = this.getFilteredEntries();
    const targetIdx = filtered.findIndex((e) => e.path === targetItem.path);
    if (targetIdx === -1) return;

    let startIdx = targetIdx;
    if (this.lastClickedItem) {
      const foundIdx = filtered.findIndex((e) => e.path === this.lastClickedItem!.path);
      if (foundIdx !== -1) {
        startIdx = foundIdx;
      }
    }

    const minIdx = Math.min(startIdx, targetIdx);
    const maxIdx = Math.max(startIdx, targetIdx);
    const rangeItems = filtered.slice(minIdx, maxIdx + 1);

    if (this.callbacks.onBatchSelect) {
      this.callbacks.onBatchSelect(rangeItems, true);
    } else {
      rangeItems.forEach((item) => this.callbacks.onCheckboxToggle(item, true));
    }
    this.lastClickedItem = targetItem;
  }

  private render(): void {
    if (!this.currentData) {
      this.container.innerHTML = `
        <div class="col-placeholder">
          <span class="placeholder-icon">📂</span>
          <span class="placeholder-text">选择上一级目录以在此展开</span>
        </div>
      `;
      return;
    }

    const { currentPath, parentPath, entries, homeDir } = this.currentData;
    const isHome = Boolean(homeDir && currentPath === homeDir);
    const folderName = isHome ? '~' : (currentPath === '/' ? '/' : currentPath.split('/').pop() || currentPath);
    const displayTitle = isHome ? `~ (${currentPath})` : currentPath;

    const filtered = this.getFilteredEntries();

    const shouldShowParentRow = this.showParentDirRow && Boolean(parentPath);

    this.container.innerHTML = `
      <!-- Column Header -->
      <div class="col-header">
        <div class="col-header-title" title="${this.escapeHtml(displayTitle)}">
          <span class="col-dir-icon">${isHome ? '🏠' : '📁'}</span>
          <span class="col-dir-name">${this.escapeHtml(folderName)}</span>
          <span class="col-item-count">(${entries.length})</span>
        </div>
        ${parentPath ? `
          <button type="button" class="cyber-btn-mini btn-col-up" title="返回上级: ${this.escapeHtml(parentPath)}">
            ▲ 上级
          </button>
        ` : ''}
      </div>

      <!-- Search filter -->
      <div class="col-search-bar">
        <input type="text" class="col-filter-input" placeholder="过滤当前列..." value="${this.escapeHtml(this.filterQuery)}" />
        ${this.filterQuery ? `<button type="button" class="btn-clear-col-filter">&times;</button>` : ''}
      </div>

      <!-- Column List -->
      <div class="col-list-wrapper">
        ${shouldShowParentRow ? `
          <div class="file-row dir-row parent-dir-row" data-parent-path="${this.escapeHtml(parentPath!)}" title="返回上级: ${this.escapeHtml(parentPath!)}">
            <span class="row-checkbox-placeholder"></span>
            <span class="row-icon">📁</span>
            <span class="row-name">..</span>
          </div>
        ` : ''}
        ${filtered.length === 0 && !shouldShowParentRow ? `
          <div class="col-empty-msg">空目录或未匹配到文件</div>
        ` : filtered.map((item) => {
          const isFileSelected = this.selectedFilePath === item.path;
          const isFolderActive = this.activeFolderPath === item.path;
          const isMulti = this.multiSelectedPaths.has(item.path);
          const isEditing = this.isEditingPath === item.path;

          let rowClasses = 'file-row';
          if (item.isDirectory) rowClasses += ' dir-row';
          else rowClasses += ' item-row';
          if (isFileSelected) rowClasses += ' file-row-selected';
          if (isFolderActive) rowClasses += ' folder-row-active';
          if (isMulti) rowClasses += ' file-row-multi-selected';

          const icon = item.isDirectory ? '📁' : this.getFileIcon(item.extension);
          const sizeStr = item.isDirectory ? '' : this.formatSize(item.size);

          return `
            <div class="${rowClasses}" data-path="${this.escapeHtml(item.path)}">
              <!-- Weak/Subtle Multi-select Checkbox -->
              <span class="row-checkbox ${isMulti ? 'checkbox-checked' : ''}" data-path="${this.escapeHtml(item.path)}" title="多选">
                <svg class="check-box-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                  ${isMulti
                    ? '<rect x="3" y="3" width="18" height="18" rx="3" fill="#00e5ff" stroke="#00e5ff"/><path d="M7 12l3 3 7-7" stroke="#080c14" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'
                    : '<rect x="3" y="3" width="18" height="18" rx="3" stroke="#64748b"/>'}
                </svg>
              </span>

              <span class="row-icon">${icon}</span>

              <!-- Inline rename input or regular name -->
              ${isEditing ? `
                <input type="text" class="inline-rename-input" data-path="${this.escapeHtml(item.path)}" value="${this.escapeHtml(item.name)}" />
              ` : `
                <span class="row-name" title="${this.escapeHtml(item.name)}">${this.escapeHtml(item.name)}</span>
              `}

              ${sizeStr ? `<span class="col-size">${sizeStr}</span>` : ''}

              ${item.isDirectory ? `<span class="dir-arrow">›</span>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;

    this.bindEvents();
  }

  private updateRowSelection(): void {
    this.container.querySelectorAll<HTMLElement>('.file-row').forEach((row) => {
      if (row.classList.contains('parent-dir-row')) return;
      const p = row.getAttribute('data-path');
      if (!p) return;

      const isFileSelected = this.selectedFilePath === p;
      const isFolderActive = this.activeFolderPath === p;
      const isMulti = this.multiSelectedPaths.has(p);

      row.classList.toggle('file-row-selected', isFileSelected);
      row.classList.toggle('folder-row-active', isFolderActive);
      row.classList.toggle('file-row-multi-selected', isMulti);

      const checkbox = row.querySelector<HTMLElement>('.row-checkbox');
      if (checkbox) {
        checkbox.classList.toggle('checkbox-checked', isMulti);
        checkbox.innerHTML = `
          <svg class="check-box-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            ${isMulti
              ? '<rect x="3" y="3" width="18" height="18" rx="3" fill="#00e5ff" stroke="#00e5ff"/><path d="M7 12l3 3 7-7" stroke="#080c14" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'
              : '<rect x="3" y="3" width="18" height="18" rx="3" stroke="#64748b"/>'}
          </svg>
        `;
      }
    });
  }

  private bindEvents(): void {
    if (!this.currentData) return;

    // Up button
    this.container.querySelector('.btn-col-up')?.addEventListener('click', () => {
      if (this.currentData?.parentPath) {
        this.callbacks.onNavigateUp?.(this.currentData.parentPath);
      }
    });

    // Parent row (..) click
    const parentRow = this.container.querySelector<HTMLElement>('.parent-dir-row');
    if (parentRow && this.currentData?.parentPath) {
      parentRow.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onNavigateUp?.(this.currentData!.parentPath!);
      });
    }

    // Filter
    const filterInput = this.container.querySelector<HTMLInputElement>('.col-filter-input');
    if (filterInput) {
      filterInput.addEventListener('input', () => {
        this.filterQuery = filterInput.value;
        this.render();
      });
    }

    this.container.querySelector('.btn-clear-col-filter')?.addEventListener('click', () => {
      this.filterQuery = '';
      this.render();
    });

    // Inline rename inputs
    this.container.querySelectorAll<HTMLInputElement>('.inline-rename-input').forEach((input) => {
      const p = input.getAttribute('data-path');
      const item = this.currentData?.entries.find((e) => e.path === p);
      if (!item) return;

      let isCommitted = false;

      const commit = async () => {
        if (isCommitted) return;
        isCommitted = true;
        const newName = input.value.trim();
        if (newName && newName !== item.name) {
          const success = await this.callbacks.onInlineRename(item, newName);
          if (success) {
            item.name = newName;
          }
        }
        this.isEditingPath = null;
        this.render();
      };

      const cancel = () => {
        if (isCommitted) return;
        isCommitted = true;
        this.isEditingPath = null;
        this.render();
      };

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      });

      input.addEventListener('blur', () => {
        commit();
      });

      // Prevent row click when clicking on input
      input.addEventListener('click', (e) => e.stopPropagation());
    });

    // Row clicks & Checkbox toggles
    this.container.querySelectorAll<HTMLElement>('.file-row').forEach((row) => {
      if (row.classList.contains('parent-dir-row')) return;
      const p = row.getAttribute('data-path');
      const item = this.currentData?.entries.find((e) => e.path === p);
      if (!item) return;

      // Checkbox click
      const checkbox = row.querySelector('.row-checkbox');
      checkbox?.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        const me = e as MouseEvent;
        const isShift = me.shiftKey || Boolean((window as any).__webterm_shift_active) || Boolean((window as any).__webterm_shift_down);
        if (isShift) {
          this.handleRangeSelect(item);
          return;
        }

        const willCheck = !this.multiSelectedPaths.has(item.path);
        this.callbacks.onCheckboxToggle(item, willCheck);
        this.lastClickedItem = item;
      });

      // Row body click
      row.addEventListener('click', (e: MouseEvent) => {
        // If clicking checkbox or rename input, ignore
        if ((e.target as HTMLElement).closest('.row-checkbox') || (e.target as HTMLElement).closest('.inline-rename-input')) {
          return;
        }

        const isCtrl = e.ctrlKey || e.metaKey || Boolean((window as any).__webterm_ctrl_latched) || Boolean((window as any).__webterm_ctrl_down);
        const isShift = e.shiftKey || Boolean((window as any).__webterm_shift_active) || Boolean((window as any).__webterm_shift_down);

        if (isShift) {
          e.preventDefault();
          this.handleRangeSelect(item);
          return;
        }

        if (isCtrl) {
          e.preventDefault();
          const willCheck = !this.multiSelectedPaths.has(item.path);
          this.callbacks.onCheckboxToggle(item, willCheck);
          this.lastClickedItem = item;
          return;
        }

        // Regular click (without modifier keys): update anchor and drill-down / preview
        this.lastClickedItem = item;
        if (item.isDirectory) {
          this.callbacks.onFolderClick(item);
        } else {
          // File clicked
          const isAlreadySelected = this.selectedFilePath === item.path;
          this.callbacks.onFileClick(item, isAlreadySelected);
        }
      });
    });

    // Drag and Drop Upload onto this column
    const listWrapper = this.container.querySelector<HTMLElement>('.col-list-wrapper');
    if (listWrapper && this.currentData) {
      listWrapper.addEventListener('dragover', (e) => {
        e.preventDefault();
        listWrapper.classList.add('drop-target-active');
      });
      listWrapper.addEventListener('dragleave', (e) => {
        e.preventDefault();
        listWrapper.classList.remove('drop-target-active');
      });
      listWrapper.addEventListener('drop', (e) => {
        e.preventDefault();
        listWrapper.classList.remove('drop-target-active');
        if (e.dataTransfer && e.dataTransfer.files.length > 0) {
          this.callbacks.onDropFiles(e.dataTransfer.files, this.currentData!.currentPath);
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
