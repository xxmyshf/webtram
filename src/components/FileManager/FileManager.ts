import { FileToolbar } from './FileToolbar.js';
import { DirectoryColumn } from './DirectoryColumn.js';
import { FilePreviewPane } from './FilePreviewPane.js';
import { BinaryInspectorPane } from './BinaryInspectorPane.js';
import { FileEntry, FileReadResult, ListDirResult, ClipboardState } from './types.js';
import { cyberToast, cyberConfirm, cyberPrompt } from './CyberDialog.js';

export interface FileManagerCallbacks {
  sendWsMessage: (msg: any) => void;
  getAuthPassword: () => string;
  onOpenInTerminal: (dirPath: string) => void;
  onSwitchToTerminal: () => void;
}

export class FileManager {
  private container: HTMLElement;
  private callbacks: FileManagerCallbacks;

  // Header Toolbar
  private toolbar!: FileToolbar;

  // View 1: 3-Window Sliding Directory View (when NO file selected)
  private threeColumnContainer!: HTMLElement;
  private col0!: DirectoryColumn;
  private col1!: DirectoryColumn;
  private col2!: DirectoryColumn;
  private breadcrumbBar!: HTMLElement;

  // Viewport & Navigation stack
  private navStack: string[] = []; // Hierarchy chain of directories, e.g. ['/home/user', '/home/user/Project']
  private windowStart = 0;         // Starting index within navStack for the 3 visible windows
  private homeDir = '';            // Host user's home directory (e.g. '/home/user')
  private dirCache = new Map<string, ListDirResult>(); // Fast directory cache

  // View 2: 1-Column + Dual Preview Pane (when a file IS selected)
  private oneColumnContainer!: HTMLElement;
  private singleCol!: DirectoryColumn;
  private previewPane!: FilePreviewPane;
  private binaryInspector!: BinaryInspectorPane;

  // State
  private currentDir = '';
  private selectedFile: FileEntry | null = null;
  private selectedItems = new Map<string, FileEntry>();
  private clipboard: ClipboardState | null = null;

  private pendingRequests = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private hiddenFileInput: HTMLInputElement | null = null;

  constructor(callbacks: FileManagerCallbacks) {
    this.callbacks = callbacks;
    this.container = document.createElement('div');
    this.container.className = 'cyber-file-manager';
    this.init();
  }

  public getElement(): HTMLElement {
    return this.container;
  }

  public show(): void {
    this.container.style.display = 'flex';
    if (!this.currentDir) {
      this.loadDirectory('~');
    }
  }

  public hide(): void {
    this.container.style.display = 'none';
  }

  public isVisible(): boolean {
    return this.container.style.display !== 'none';
  }

  /**
   * 处理 WebSocket 响应报文
   */
  public handleWsMessage(payload: any): boolean {
    if (!payload || !payload.type) return false;

    if (payload.type === 'fs_list_res' || payload.type === 'fs_read_res' || payload.type === 'fs_action_res') {
      const { reqId } = payload;
      if (reqId && this.pendingRequests.has(reqId)) {
        const { resolve } = this.pendingRequests.get(reqId)!;
        this.pendingRequests.delete(reqId);
        resolve(payload);
        return true;
      }
    }
    return false;
  }

  private init(): void {
    // 隐藏的文件上传 input
    this.hiddenFileInput = document.createElement('input');
    this.hiddenFileInput.type = 'file';
    this.hiddenFileInput.multiple = true;
    this.hiddenFileInput.style.display = 'none';
    document.body.appendChild(this.hiddenFileInput);

    this.hiddenFileInput.addEventListener('change', () => {
      if (this.hiddenFileInput?.files && this.hiddenFileInput.files.length > 0) {
        this.uploadFiles(this.hiddenFileInput.files, this.currentDir);
        this.hiddenFileInput.value = '';
      }
    });

    // 1. Toolbar
    this.toolbar = new FileToolbar({
      onCreateFile: () => this.promptCreateFile(),
      onCreateDir: () => this.promptCreateDir(),
      onRename: () => this.triggerRename(),
      onDelete: () => this.confirmDelete(),
      onCopy: () => this.copySelectedToClipboard(),
      onPaste: () => this.pasteFromClipboard(),
      onUpload: () => this.hiddenFileInput?.click(),
      onDownload: () => this.downloadSelected(),
      onCopyPath: () => this.copyPath(),
      onRefresh: () => this.refreshCurrentDir(),
      onOpenInTerminal: () => this.openInTerminal(),
      onClearMultiSelect: () => this.clearMultiSelect()
    });
    this.container.appendChild(this.toolbar.getElement());

    // 2. Breadcrumb Navigation Bar
    this.breadcrumbBar = document.createElement('div');
    this.breadcrumbBar.className = 'fm-breadcrumb-bar';
    this.breadcrumbBar.id = 'fm-breadcrumb-bar';

    // 3. View 1: 3-Window Sliding Directory View
    this.threeColumnContainer = document.createElement('div');
    this.threeColumnContainer.className = 'fm-three-column-container';

    this.col0 = new DirectoryColumn({
      onFolderClick: (folder) => this.handleColumnFolderClick(0, folder),
      onFileClick: (file, isAlreadySelected) => this.handleFileClick(file, isAlreadySelected, 0),
      onCheckboxToggle: (item, checked) => this.handleCheckboxToggle(item, checked),
      onInlineRename: (item, newName) => this.performRename(item, newName),
      onDropFiles: (files, targetDir) => this.uploadFiles(files, targetDir),
      onNavigateUp: (parent) => this.handleColumnNavigateUp(0, parent)
    }, 'col-level-0');
    this.col0.setShowParentDirRow(true);

    this.col1 = new DirectoryColumn({
      onFolderClick: (folder) => this.handleColumnFolderClick(1, folder),
      onFileClick: (file, isAlreadySelected) => this.handleFileClick(file, isAlreadySelected, 1),
      onCheckboxToggle: (item, checked) => this.handleCheckboxToggle(item, checked),
      onInlineRename: (item, newName) => this.performRename(item, newName),
      onDropFiles: (files, targetDir) => this.uploadFiles(files, targetDir),
      onNavigateUp: (parent) => this.handleColumnNavigateUp(1, parent)
    }, 'col-level-1');
    this.col1.setShowParentDirRow(false);

    this.col2 = new DirectoryColumn({
      onFolderClick: (folder) => this.handleColumnFolderClick(2, folder),
      onFileClick: (file, isAlreadySelected) => this.handleFileClick(file, isAlreadySelected, 2),
      onCheckboxToggle: (item, checked) => this.handleCheckboxToggle(item, checked),
      onInlineRename: (item, newName) => this.performRename(item, newName),
      onDropFiles: (files, targetDir) => this.uploadFiles(files, targetDir),
      onNavigateUp: (parent) => this.handleColumnNavigateUp(2, parent)
    }, 'col-level-2');
    this.col2.setShowParentDirRow(false);

    this.threeColumnContainer.appendChild(this.col0.getElement());
    this.threeColumnContainer.appendChild(this.col1.getElement());
    this.threeColumnContainer.appendChild(this.col2.getElement());

    // 4. View 2: 1-Column + Dual Preview Workspace
    this.oneColumnContainer = document.createElement('div');
    this.oneColumnContainer.className = 'fm-one-column-container';
    this.oneColumnContainer.style.display = 'none';

    this.singleCol = new DirectoryColumn({
      onFolderClick: (folder) => {
        // In 1-column mode, clicking a folder navigates into it and deselects file
        this.deselectFile();
        this.handleColumnFolderClick(0, folder);
      },
      onFileClick: (file, isAlreadySelected) => this.handleFileClick(file, isAlreadySelected, -1),
      onCheckboxToggle: (item, checked) => this.handleCheckboxToggle(item, checked),
      onInlineRename: (item, newName) => this.performRename(item, newName),
      onDropFiles: (files, targetDir) => this.uploadFiles(files, targetDir),
      onNavigateUp: (parent) => {
        this.deselectFile();
        this.handleColumnNavigateUp(0, parent);
      }
    }, 'single-col-pane');
    this.singleCol.setShowParentDirRow(true);

    const rightWorkspace = document.createElement('div');
    rightWorkspace.className = 'fm-right-workspace';

    this.previewPane = new FilePreviewPane({
      onSaveFile: async (path, content) => this.saveFile(path, content),
      getAuthPassword: () => this.callbacks.getAuthPassword(),
      onClosePreview: () => this.deselectFile()
    });

    this.binaryInspector = new BinaryInspectorPane();

    const previewCol = document.createElement('div');
    previewCol.className = 'fm-preview-column';
    previewCol.appendChild(this.previewPane.getElement());

    const binaryCol = document.createElement('div');
    binaryCol.className = 'fm-binary-column';
    binaryCol.appendChild(this.binaryInspector.getElement());

    rightWorkspace.appendChild(previewCol);
    rightWorkspace.appendChild(binaryCol);

    this.oneColumnContainer.appendChild(this.singleCol.getElement());
    this.oneColumnContainer.appendChild(rightWorkspace);

    this.container.appendChild(this.breadcrumbBar);
    this.container.appendChild(this.threeColumnContainer);
    this.container.appendChild(this.oneColumnContainer);

    // Global keyboard shortcuts for copy/paste inside FileManager
    window.addEventListener('keydown', (e) => {
      if (!this.isVisible()) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        // If not in a text input or textarea
        const tag = (document.activeElement?.tagName || '').toLowerCase();
        if (tag !== 'input' && tag !== 'textarea') {
          e.preventDefault();
          this.copySelectedToClipboard();
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
        const tag = (document.activeElement?.tagName || '').toLowerCase();
        if (tag !== 'input' && tag !== 'textarea') {
          e.preventDefault();
          this.pasteFromClipboard();
        }
      } else if (e.key === 'F2') {
        e.preventDefault();
        this.triggerRename();
      }
    });
  }

  /**
   * 加载当前/指定目录（默认加载 ~ 用户主目录，初始仅加载单列表）
   */
  public async loadDirectory(dirPath: string = '~'): Promise<void> {
    try {
      const res = await this.fetchDirData(dirPath);
      if (!res || res.error) {
        cyberToast(res?.error || '读取目录失败', 'error');
        return;
      }

      if (res.homeDir) {
        this.homeDir = res.homeDir;
      }

      this.currentDir = res.currentPath;
      this.navStack = [res.currentPath];
      this.windowStart = 0;
      await this.renderViewport();
    } catch (err: any) {
      cyberToast(`请求目录失败: ${err.message}`, 'error');
    }
  }

  public async refreshCurrentDir(): Promise<void> {
    this.dirCache.clear();
    if (this.selectedFile) {
      // In 1-column mode, refresh singleCol
      const p = this.singleCol.getCurrentPath() || this.currentDir;
      const res = await this.fetchDirData(p, true);
      if (res) this.singleCol.setData(res);
      await this.loadFilePreview(this.selectedFile.path);
    } else {
      // Re-fetch data for active windows and update them
      const p0 = this.navStack[this.windowStart];
      const p1 = this.windowStart + 1 < this.navStack.length ? this.navStack[this.windowStart + 1] : null;
      const p2 = this.windowStart + 2 < this.navStack.length ? this.navStack[this.windowStart + 2] : null;

      if (p0) {
        const res0 = await this.fetchDirData(p0, true);
        if (res0) this.col0.setData(res0);
      }
      if (p1) {
        const res1 = await this.fetchDirData(p1, true);
        if (res1) this.col1.setData(res1);
      }
      if (p2) {
        const res2 = await this.fetchDirData(p2, true);
        if (res2) this.col2.setData(res2);
      }
      await this.renderViewport();
    }
    cyberToast('目录已刷新', 'info', 1500);
  }

  private async fetchDirData(path: string, force = false): Promise<ListDirResult | null> {
    if (!force && this.dirCache.has(path)) {
      return this.dirCache.get(path)!;
    }
    try {
      const res: ListDirResult = await this.sendFsRequest({
        type: 'fs_list',
        path
      });
      if (res.error) {
        cyberToast(res.error, 'error');
        return null;
      }
      this.dirCache.set(path, res);
      if (res.homeDir) {
        this.homeDir = res.homeDir;
      }
      return res;
    } catch {
      return null;
    }
  }

  /**
   * 更新单个列的状态，若目录路径未变化则不触碰 DOM，完整保留滚动条位置与列表元素
   */
  private async updateColumnState(
    col: DirectoryColumn,
    targetPath: string | null,
    activeChildPath: string | null
  ): Promise<void> {
    if (!targetPath) {
      col.getElement().style.display = 'none';
      col.setData(null);
      return;
    }

    col.getElement().style.display = 'flex';

    if (col.getCurrentPath() !== targetPath) {
      const data = await this.fetchDirData(targetPath);
      if (data) {
        col.setData(data);
      }
    }

    col.setActiveFolder(activeChildPath);
  }

  /**
   * 动态三窗口滑动视口渲染 (Sliding 3-Window Viewport)
   * 随着用户下钻/回退，三个窗口动态调整观察范围
   */
  private async renderViewport(scrollDirection: 'left' | 'right' | 'none' = 'none'): Promise<void> {
    if (this.navStack.length === 0) return;

    if (this.windowStart >= this.navStack.length) {
      this.windowStart = Math.max(0, this.navStack.length - 1);
    }
    if (this.windowStart < 0) {
      this.windowStart = 0;
    }

    this.currentDir = this.navStack[this.navStack.length - 1];

    const p0 = this.navStack[this.windowStart];
    const p1 = this.windowStart + 1 < this.navStack.length ? this.navStack[this.windowStart + 1] : null;
    const p2 = this.windowStart + 2 < this.navStack.length ? this.navStack[this.windowStart + 2] : null;
    const p3 = this.windowStart + 3 < this.navStack.length ? this.navStack[this.windowStart + 3] : null;

    // Window 0 (col0): 始终为当前视口第一列
    await this.updateColumnState(this.col0, p0, p1);

    // Window 1 (col1): 仅在下钻到 >=2 级时显示
    await this.updateColumnState(this.col1, p1, p2);

    // Window 2 (col2): 仅在下钻到 >=3 级时显示
    await this.updateColumnState(this.col2, p2, p3);

    // 渲染快捷层级面包屑条
    this.renderBreadcrumbBar();
    this.updateToolbarContext();

    // 视口容器平滑滚动同步
    requestAnimationFrame(() => {
      if (!this.threeColumnContainer) return;
      if (scrollDirection === 'right') {
        this.threeColumnContainer.scrollLeft = this.threeColumnContainer.scrollWidth;
      } else if (scrollDirection === 'left') {
        this.threeColumnContainer.scrollLeft = 0;
      }
    });
  }

  /**
   * 点击窗口中的文件夹：展开下级并滑动视口
   */
  private async handleColumnFolderClick(windowIdx: number, folder: FileEntry): Promise<void> {
    const stackIdx = this.windowStart + windowIdx;

    // 若点击的文件夹恰好为下级的激活项且是分支末端，保持现状
    if (this.navStack[stackIdx + 1] === folder.path && this.navStack.length === stackIdx + 2) {
      return;
    }

    // 截断该层级之后的栈，并推进新子目录
    this.navStack = this.navStack.slice(0, stackIdx + 1);
    this.navStack.push(folder.path);

    // 若新下钻深度超出当前视口容纳的 3 个窗口，视口向右滑动
    if (this.navStack.length - this.windowStart > 3) {
      this.windowStart = this.navStack.length - 3;
    }

    await this.renderViewport('right');
  }

  /**
   * 窗口内部向上返回（点击 .. 或 ▲ 上级）
   */
  private async handleColumnNavigateUp(windowIdx: number, parentPath: string): Promise<void> {
    if (windowIdx === 0) {
      if (this.windowStart > 0) {
        // 视口整体向左滑动，把父级目录加回视口
        this.windowStart -= 1;
        await this.renderViewport('left');
      } else {
        // 当前视口已处于栈顶，向前追加父级目录
        const curRoot = this.navStack[0];
        const res = await this.fetchDirData(curRoot);
        const targetParent = res?.parentPath || parentPath;
        if (targetParent) {
          this.navStack.unshift(targetParent);
          this.windowStart = 0;
          await this.renderViewport('left');
        }
      }
    } else if (windowIdx === 1) {
      // 在 Window 1 上点上级：关闭 Window 1 和 2，回到 Window 0
      this.navStack = this.navStack.slice(0, this.windowStart + 1);
      await this.renderViewport('left');
    } else if (windowIdx === 2) {
      // 在 Window 2 上点上级：关闭 Window 2，回到 Window 1
      this.navStack = this.navStack.slice(0, this.windowStart + 2);
      await this.renderViewport('left');
    }
  }

  /**
   * 渲染快捷层级面包屑条
   */
  private renderBreadcrumbBar(): void {
    if (!this.breadcrumbBar) return;
    this.breadcrumbBar.innerHTML = '';

    const trail = document.createElement('div');
    trail.className = 'fm-breadcrumb-trail';

    this.navStack.forEach((pathItem, idx) => {
      if (idx > 0) {
        const sep = document.createElement('span');
        sep.className = 'fm-breadcrumb-sep';
        sep.textContent = '/';
        trail.appendChild(sep);
      }

      let displayName = pathItem;
      if (this.homeDir && pathItem === this.homeDir) {
        displayName = '~';
      } else if (pathItem === '/') {
        displayName = '/';
      } else {
        displayName = pathItem.split('/').filter(Boolean).pop() || pathItem;
      }

      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'fm-breadcrumb-chip';
      if (idx === this.navStack.length - 1) {
        chip.classList.add('chip-active');
      }
      chip.title = `点击切换至: ${pathItem}`;
      chip.textContent = displayName;
      chip.addEventListener('click', () => {
        this.jumpToStackIndex(idx);
      });

      trail.appendChild(chip);
    });

    const actions = document.createElement('div');
    actions.className = 'fm-breadcrumb-actions';

    // 快速回到主目录 (~) 按钮
    const homeBtn = document.createElement('button');
    homeBtn.type = 'button';
    homeBtn.className = 'fm-breadcrumb-action-btn';
    homeBtn.title = '快速跳转到用户主目录 (~)';
    homeBtn.innerHTML = `<span>🏠</span><span>主目录 (~)</span>`;
    homeBtn.addEventListener('click', () => {
      this.loadDirectory('~');
    });
    actions.appendChild(homeBtn);

    // 视口观察范围指示徽章（当下钻 >3 层时展示）
    if (this.navStack.length > 3) {
      const badge = document.createElement('span');
      badge.className = 'fm-viewport-badge';
      const visibleStart = this.windowStart + 1;
      const visibleEnd = Math.min(this.navStack.length, this.windowStart + 3);
      badge.title = `三窗口视口正观察第 ${visibleStart} 至 ${visibleEnd} 级目录（共 ${this.navStack.length} 级）`;
      badge.textContent = `👁 窗口 ${visibleStart}-${visibleEnd}/${this.navStack.length}`;
      actions.appendChild(badge);
    }

    this.breadcrumbBar.appendChild(trail);
    this.breadcrumbBar.appendChild(actions);
  }

  /**
   * 点击面包屑直接跳转层级
   */
  private async jumpToStackIndex(idx: number): Promise<void> {
    if (idx < 0 || idx >= this.navStack.length) return;
    this.navStack = this.navStack.slice(0, idx + 1);
    this.windowStart = Math.max(0, this.navStack.length - 3);
    await this.renderViewport();
  }

  /**
   * 处理文件点击（核心切换点：选中开启1列+预览；再点取消选恢复3列）
   */
  private async handleFileClick(file: FileEntry, isAlreadySelected: boolean, colIdx: number): Promise<void> {
    if (isAlreadySelected) {
      // Requirement 7: 选中文件再点能够取消文件
      this.deselectFile();
      return;
    }

    // 选中文件 -> 启动 1 栏 + 预览框 (Requirement 8)
    this.selectedFile = file;
    this.selectedItems.clear();
    this.selectedItems.set(file.path, file);

    // 确定单栏展示的父目录
    const parentDir = file.path.substring(0, file.path.lastIndexOf('/')) || '/';
    this.currentDir = parentDir;

    // 切换视图布局
    this.threeColumnContainer.style.display = 'none';
    this.oneColumnContainer.style.display = 'flex';

    // 加载单栏数据
    if (this.singleCol.getCurrentPath() !== parentDir) {
      const parentData = await this.fetchDirData(parentDir);
      if (parentData) {
        this.singleCol.setData(parentData);
      }
    }
    this.singleCol.setSelectedFile(file.path);

    // 载入双栏预览
    await this.loadFilePreview(file.path);
    this.updateToolbarContext();
  }

  /**
   * 取消文件选中，恢复 3 栏目录布局
   */
  public deselectFile(): void {
    this.selectedFile = null;
    this.selectedItems.clear();

    // 切换回 3 栏
    this.oneColumnContainer.style.display = 'none';
    this.threeColumnContainer.style.display = 'flex';

    // 清空选择状态
    this.col0.setSelectedFile(null);
    this.col1.setSelectedFile(null);
    this.col2.setSelectedFile(null);
    this.singleCol.setSelectedFile(null);

    this.previewPane.render(null);
    this.binaryInspector.render(null);

    this.renderViewport();
  }

  /**
   * 多选 Checkbox 切换
   */
  private handleCheckboxToggle(item: FileEntry, checked: boolean): void {
    if (checked) {
      this.selectedItems.set(item.path, item);
    } else {
      this.selectedItems.delete(item.path);
    }

    const pathsSet = new Set(this.selectedItems.keys());
    this.col0.setMultiSelectedPaths(pathsSet);
    this.col1.setMultiSelectedPaths(pathsSet);
    this.col2.setMultiSelectedPaths(pathsSet);
    this.singleCol.setMultiSelectedPaths(pathsSet);

    this.updateToolbarContext();
  }

  public clearMultiSelect(): void {
    this.selectedItems.clear();
    const pathsSet = new Set<string>();
    this.col0.setMultiSelectedPaths(pathsSet);
    this.col1.setMultiSelectedPaths(pathsSet);
    this.col2.setMultiSelectedPaths(pathsSet);
    this.singleCol.setMultiSelectedPaths(pathsSet);
    this.updateToolbarContext();
  }

  private updateToolbarContext(): void {
    const items = Array.from(this.selectedItems.values());
    this.toolbar.updateContext(this.currentDir, items, this.clipboard);
  }

  public async loadFilePreview(filePath: string): Promise<void> {
    try {
      const res: FileReadResult = await this.sendFsRequest({
        type: 'fs_read',
        path: filePath,
        maxTextBytes: 512 * 1024
      });

      this.previewPane.render(res);
      this.binaryInspector.render(res);
    } catch (err: any) {
      cyberToast(`加载文件预览失败: ${err.message}`, 'error');
    }
  }

  private async saveFile(filePath: string, content: string): Promise<boolean> {
    try {
      const res = await this.sendFsRequest({
        type: 'fs_action',
        action: 'write_file',
        params: { path: filePath, content }
      });
      if (res.success) {
        cyberToast('文件保存成功', 'success', 2000);
      } else {
        cyberToast(`保存失败: ${res.error}`, 'error');
      }
      return res.success;
    } catch (err: any) {
      cyberToast(`保存异常: ${err.message}`, 'error');
      return false;
    }
  }

  /**
   * 触发列表中直接重命名 (Requirement 2)
   */
  private triggerRename(): void {
    if (this.selectedItems.size !== 1) return;
    const item = Array.from(this.selectedItems.values())[0];

    // Tell the active column to start inline renaming
    if (this.selectedFile) {
      this.singleCol.startInlineRename(item);
    } else {
      if (this.col0.getData()?.entries.some((e) => e.path === item.path)) {
        this.col0.startInlineRename(item);
      } else if (this.col1.getData()?.entries.some((e) => e.path === item.path)) {
        this.col1.startInlineRename(item);
      } else if (this.col2.getData()?.entries.some((e) => e.path === item.path)) {
        this.col2.startInlineRename(item);
      }
    }
  }

  private async performRename(item: FileEntry, newName: string): Promise<boolean> {
    try {
      const res = await this.sendFsRequest({
        type: 'fs_action',
        action: 'rename',
        params: { oldPath: item.path, newName }
      });

      if (res.success) {
        cyberToast(`重命名成功: "${item.name}" ➜ "${newName}"`, 'success');
        this.selectedItems.delete(item.path);
        item.path = res.data;
        item.name = newName;
        this.selectedItems.set(item.path, item);
        if (this.selectedFile && this.selectedFile.path === item.path) {
          this.selectedFile = item;
        }
        this.updateToolbarContext();
        return true;
      } else {
        cyberToast(`重命名失败: ${res.error}`, 'error');
        return false;
      }
    } catch (err: any) {
      cyberToast(`重命名异常: ${err.message}`, 'error');
      return false;
    }
  }

  /**
   * 复制选中项到剪贴板 (Requirement 6)
   */
  private copySelectedToClipboard(): void {
    const items = Array.from(this.selectedItems.values());
    if (items.length === 0) return;

    this.clipboard = { mode: 'copy', items: [...items] };
    cyberToast(`已复制 ${items.length} 个项目到剪贴板，切换到目标目录后点击“粘贴”`, 'success');
    this.updateToolbarContext();
  }

  /**
   * 粘贴剪贴板项到当前目录 (Requirement 6)
   */
  private async pasteFromClipboard(): Promise<void> {
    if (!this.clipboard || this.clipboard.items.length === 0) return;

    const sourcePaths = this.clipboard.items.map((i) => i.path);
    try {
      const res = await this.sendFsRequest({
        type: 'fs_action',
        action: 'copy',
        params: { sourcePaths, targetDir: this.currentDir }
      });

      if (res.success) {
        const count = res.data?.copiedPaths?.length || sourcePaths.length;
        cyberToast(`成功粘贴 ${count} 个项目到当前目录`, 'success');
        await this.refreshCurrentDir();
      } else {
        cyberToast(`粘贴失败: ${res.error}`, 'error');
      }
    } catch (err: any) {
      cyberToast(`粘贴异常: ${err.message}`, 'error');
    }
  }

  /**
   * 删除选中项 (Requirement 4: 精准确认与高频删除)
   */
  private async confirmDelete(): Promise<void> {
    const targets = Array.from(this.selectedItems.values());
    if (targets.length === 0) return;

    const confirmed = await cyberConfirm({
      title: '⚠️ 永久删除确认',
      message: `确定要永久删除以下 ${targets.length} 个项目吗？此操作不可逆！`,
      targets: targets.map((t) => `${t.isDirectory ? '📁' : '📄'} ${t.path}`),
      confirmText: '永久删除',
      cancelText: '取消',
      isDanger: true
    });

    if (!confirmed) return;

    try {
      const res = await this.sendFsRequest({
        type: 'fs_action',
        action: 'batch_delete',
        params: { targetPaths: targets.map((t) => t.path) }
      });

      if (res.success) {
        cyberToast(`已成功删除 ${targets.length} 个项目`, 'success');
        this.deselectFile();
        await this.refreshCurrentDir();
      } else {
        cyberToast(`删除失败: ${res.error}`, 'error');
      }
    } catch (err: any) {
      cyberToast(`删除异常: ${err.message}`, 'error');
    }
  }

  private async promptCreateFile(): Promise<void> {
    const fileName = await cyberPrompt({
      title: '新建文件',
      placeholder: '请输入文件名 (如 main.ts):',
      confirmText: '创建'
    });
    if (!fileName) return;

    try {
      const res = await this.sendFsRequest({
        type: 'fs_action',
        action: 'create_file',
        params: { parentDir: this.currentDir, name: fileName }
      });

      if (res.success) {
        cyberToast(`文件 "${fileName}" 创建成功`, 'success');
        await this.refreshCurrentDir();
      } else {
        cyberToast(`创建失败: ${res.error}`, 'error');
      }
    } catch (err: any) {
      cyberToast(`创建异常: ${err.message}`, 'error');
    }
  }

  private async promptCreateDir(): Promise<void> {
    const dirName = await cyberPrompt({
      title: '新建文件夹',
      placeholder: '请输入文件夹名称:',
      confirmText: '创建'
    });
    if (!dirName) return;

    try {
      const res = await this.sendFsRequest({
        type: 'fs_action',
        action: 'create_dir',
        params: { parentDir: this.currentDir, name: dirName }
      });

      if (res.success) {
        cyberToast(`目录 "${dirName}" 创建成功`, 'success');
        await this.refreshCurrentDir();
      } else {
        cyberToast(`创建目录失败: ${res.error}`, 'error');
      }
    } catch (err: any) {
      cyberToast(`创建异常: ${err.message}`, 'error');
    }
  }

  private downloadSelected(): void {
    const items = Array.from(this.selectedItems.values());
    if (items.length !== 1 || items[0].isDirectory) return;

    const item = items[0];
    const authPwd = encodeURIComponent(this.callbacks.getAuthPassword());
    const downloadUrl = `/api/fs/download?path=${encodeURIComponent(item.path)}&pwd=${authPwd}`;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  private copyPath(): void {
    const items = Array.from(this.selectedItems.values());
    const target = items.length > 0 ? items.map((i) => i.path).join('\n') : this.currentDir;
    navigator.clipboard.writeText(target).then(() => {
      cyberToast(`已复制路径到剪贴板:\n${target}`, 'success');
    });
  }

  private openInTerminal(): void {
    const items = Array.from(this.selectedItems.values());
    let target = this.currentDir;
    if (items.length === 1 && items[0].isDirectory) {
      target = items[0].path;
    }
    this.callbacks.onOpenInTerminal(target);
  }

  private async uploadFiles(files: FileList, targetDir: string): Promise<void> {
    const authPwd = this.callbacks.getAuthPassword();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const targetPath = `${targetDir}/${file.name}`.replace(/\/+/g, '/');

      try {
        const res = await fetch(`/api/fs/upload?path=${encodeURIComponent(targetPath)}`, {
          method: 'POST',
          headers: {
            'x-webterm-pwd': authPwd,
            'Content-Type': 'application/octet-stream'
          },
          body: file
        });
        const result = await res.json();
        if (result.success) {
          cyberToast(`上传 ${file.name} 成功`, 'success');
        } else {
          cyberToast(`上传 ${file.name} 失败: ${result.error}`, 'error');
        }
      } catch (err: any) {
        cyberToast(`上传 ${file.name} 异常: ${err.message}`, 'error');
      }
    }

    await this.refreshCurrentDir();
  }

  private sendFsRequest(payload: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const reqId = 'req-' + Math.random().toString(36).substring(2, 9);
      payload.reqId = reqId;

      this.pendingRequests.set(reqId, { resolve, reject });

      setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          reject(new Error('请求超时'));
        }
      }, 10000);

      this.callbacks.sendWsMessage(payload);
    });
  }
}
