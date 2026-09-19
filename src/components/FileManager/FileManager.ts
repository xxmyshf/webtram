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

  // View 1: 3-Level Miller Columns (when NO file selected)
  private threeColumnContainer!: HTMLElement;
  private col0!: DirectoryColumn;
  private col1!: DirectoryColumn;
  private col2!: DirectoryColumn;
  private colPaths: [string, string, string] = ['', '', ''];

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
      this.refreshCurrentDir();
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

    // 2. View 1: 3-Column Miller Directory View
    this.threeColumnContainer = document.createElement('div');
    this.threeColumnContainer.className = 'fm-three-column-container';

    this.col0 = new DirectoryColumn({
      onFolderClick: (folder) => this.handleCol0FolderClick(folder),
      onFileClick: (file, isAlreadySelected) => this.handleFileClick(file, isAlreadySelected, 0),
      onCheckboxToggle: (item, checked) => this.handleCheckboxToggle(item, checked),
      onInlineRename: (item, newName) => this.performRename(item, newName),
      onDropFiles: (files, targetDir) => this.uploadFiles(files, targetDir),
      onNavigateUp: (parent) => this.navigateCol0Up(parent)
    }, 'col-level-0');

    this.col1 = new DirectoryColumn({
      onFolderClick: (folder) => this.handleCol1FolderClick(folder),
      onFileClick: (file, isAlreadySelected) => this.handleFileClick(file, isAlreadySelected, 1),
      onCheckboxToggle: (item, checked) => this.handleCheckboxToggle(item, checked),
      onInlineRename: (item, newName) => this.performRename(item, newName),
      onDropFiles: (files, targetDir) => this.uploadFiles(files, targetDir),
      onNavigateUp: (parent) => this.loadCol1(parent)
    }, 'col-level-1');

    this.col2 = new DirectoryColumn({
      onFolderClick: (folder) => this.handleCol2FolderClick(folder),
      onFileClick: (file, isAlreadySelected) => this.handleFileClick(file, isAlreadySelected, 2),
      onCheckboxToggle: (item, checked) => this.handleCheckboxToggle(item, checked),
      onInlineRename: (item, newName) => this.performRename(item, newName),
      onDropFiles: (files, targetDir) => this.uploadFiles(files, targetDir),
      onNavigateUp: (parent) => this.loadCol2(parent)
    }, 'col-level-2');

    this.threeColumnContainer.appendChild(this.col0.getElement());
    this.threeColumnContainer.appendChild(this.col1.getElement());
    this.threeColumnContainer.appendChild(this.col2.getElement());

    // 3. View 2: 1-Column + Dual Preview Workspace
    this.oneColumnContainer = document.createElement('div');
    this.oneColumnContainer.className = 'fm-one-column-container';
    this.oneColumnContainer.style.display = 'none';

    this.singleCol = new DirectoryColumn({
      onFolderClick: (folder) => {
        // In 1-column mode, clicking a folder navigates into it and deselects file
        this.deselectFile();
        this.loadDirectory(folder.path);
      },
      onFileClick: (file, isAlreadySelected) => this.handleFileClick(file, isAlreadySelected, -1),
      onCheckboxToggle: (item, checked) => this.handleCheckboxToggle(item, checked),
      onInlineRename: (item, newName) => this.performRename(item, newName),
      onDropFiles: (files, targetDir) => this.uploadFiles(files, targetDir),
      onNavigateUp: (parent) => {
        this.deselectFile();
        this.loadDirectory(parent);
      }
    }, 'single-col-pane');

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
   * 加载当前/指定目录（初始化或刷新）
   */
  public async loadDirectory(dirPath?: string): Promise<void> {
    try {
      const res: ListDirResult = await this.sendFsRequest({
        type: 'fs_list',
        path: dirPath
      });

      if (res.error) {
        cyberToast(`读取目录错误: ${res.error}`, 'error');
        return;
      }

      this.currentDir = res.currentPath;
      this.colPaths[0] = res.currentPath;
      this.col0.setData(res);

      // Check if there are subdirectories in col0, auto open the first directory in col1 if col1 is empty
      const firstDir = res.entries.find((e) => e.isDirectory);
      if (firstDir) {
        this.col0.setActiveFolder(firstDir.path);
        await this.loadCol1(firstDir.path);
      } else {
        this.col1.setData(null);
        this.col2.setData(null);
        this.colPaths[1] = '';
        this.colPaths[2] = '';
      }

      this.updateToolbarContext();
    } catch (err: any) {
      cyberToast(`请求目录失败: ${err.message}`, 'error');
    }
  }

  public async refreshCurrentDir(): Promise<void> {
    if (this.selectedFile) {
      // In 1-column mode, refresh singleCol
      const p = this.singleCol.getCurrentPath() || this.currentDir;
      const res = await this.fetchDirData(p);
      if (res) this.singleCol.setData(res);
      await this.loadFilePreview(this.selectedFile.path);
    } else {
      // In 3-column mode, reload columns
      if (this.colPaths[0]) {
        const res0 = await this.fetchDirData(this.colPaths[0]);
        if (res0) this.col0.setData(res0);
      }
      if (this.colPaths[1]) {
        const res1 = await this.fetchDirData(this.colPaths[1]);
        if (res1) this.col1.setData(res1);
      }
      if (this.colPaths[2]) {
        const res2 = await this.fetchDirData(this.colPaths[2]);
        if (res2) this.col2.setData(res2);
      }
    }
    cyberToast('目录已刷新', 'info', 1500);
  }

  private async fetchDirData(path: string): Promise<ListDirResult | null> {
    try {
      const res: ListDirResult = await this.sendFsRequest({
        type: 'fs_list',
        path
      });
      if (res.error) {
        cyberToast(res.error, 'error');
        return null;
      }
      return res;
    } catch {
      return null;
    }
  }

  private async loadCol1(dirPath: string): Promise<void> {
    this.colPaths[1] = dirPath;
    const res = await this.fetchDirData(dirPath);
    this.col1.setData(res);

    // If col1 has subdirectories, auto open the first in col2
    const firstDir = res?.entries.find((e) => e.isDirectory);
    if (firstDir) {
      this.col1.setActiveFolder(firstDir.path);
      await this.loadCol2(firstDir.path);
    } else {
      this.col2.setData(null);
      this.colPaths[2] = '';
    }
  }

  private async loadCol2(dirPath: string): Promise<void> {
    this.colPaths[2] = dirPath;
    const res = await this.fetchDirData(dirPath);
    this.col2.setData(res);
  }

  private handleCol0FolderClick(folder: FileEntry): void {
    this.currentDir = folder.path;
    this.col0.setActiveFolder(folder.path);
    this.loadCol1(folder.path);
    this.updateToolbarContext();
  }

  private handleCol1FolderClick(folder: FileEntry): void {
    this.currentDir = folder.path;
    this.col1.setActiveFolder(folder.path);
    this.loadCol2(folder.path);
    this.updateToolbarContext();
  }

  private async handleCol2FolderClick(folder: FileEntry): Promise<void> {
    // When clicking a folder in column 2, cascade shift!
    this.currentDir = folder.path;
    this.colPaths[0] = this.colPaths[1];
    this.colPaths[1] = this.colPaths[2];
    this.colPaths[2] = folder.path;

    const res0 = await this.fetchDirData(this.colPaths[0]);
    if (res0) this.col0.setData(res0);
    this.col0.setActiveFolder(this.colPaths[1]);

    const res1 = await this.fetchDirData(this.colPaths[1]);
    if (res1) this.col1.setData(res1);
    this.col1.setActiveFolder(this.colPaths[2]);

    const res2 = await this.fetchDirData(this.colPaths[2]);
    if (res2) this.col2.setData(res2);

    this.updateToolbarContext();
  }

  private async navigateCol0Up(parentPath: string): Promise<void> {
    await this.loadDirectory(parentPath);
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
    const parentData = await this.fetchDirData(parentDir);
    if (parentData) {
      this.singleCol.setData(parentData);
      this.singleCol.setSelectedFile(file.path);
    }

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

    this.updateToolbarContext();
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
