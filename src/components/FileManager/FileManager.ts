import { FileToolbar } from './FileToolbar.js';
import { FileTreePanel } from './FileTreePanel.js';
import { FilePreviewPane } from './FilePreviewPane.js';
import { BinaryInspectorPane } from './BinaryInspectorPane.js';
import { FileEntry, FileReadResult, ListDirResult } from './types.js';

export interface FileManagerCallbacks {
  sendWsMessage: (msg: any) => void;
  getAuthPassword: () => string;
  onOpenInTerminal: (dirPath: string) => void;
  onSwitchToTerminal: () => void;
}

export class FileManager {
  private container: HTMLElement;
  private callbacks: FileManagerCallbacks;

  private toolbar!: FileToolbar;
  private treePanel!: FileTreePanel;
  private previewPane!: FilePreviewPane;
  private binaryInspector!: BinaryInspectorPane;

  private pendingRequests = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private hiddenFileInput: HTMLInputElement | null = null;
  private currentDir = '';

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
   * 处理由主 WebSocket 管道转发过来的文件系统响应报文
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
      onRename: (item) => this.promptRename(item),
      onDelete: (item) => this.confirmDelete(item),
      onUpload: () => this.hiddenFileInput?.click(),
      onDownload: (item) => this.downloadFile(item),
      onCopyPath: (item) => this.copyPath(item),
      onRefresh: () => this.refreshCurrentDir(),
      onOpenInTerminal: (dirPath) => this.callbacks.onOpenInTerminal(dirPath)
    });

    // 2. Tree Panel
    this.treePanel = new FileTreePanel({
      onNavigate: (targetPath) => this.loadDirectory(targetPath),
      onSelectFile: (file) => this.loadFilePreview(file.path),
      onFilesDropped: (files, targetDir) => this.uploadFiles(files, targetDir)
    });

    // 3. Preview Pane (Left column of preview area)
    this.previewPane = new FilePreviewPane({
      onSaveFile: async (path, content) => this.saveFile(path, content),
      getAuthPassword: () => this.callbacks.getAuthPassword()
    });

    // 4. Binary Inspector (Right column of preview area: Top Hex + Bottom Visual)
    this.binaryInspector = new BinaryInspectorPane();

    // 组装整体布局
    const leftPane = document.createElement('div');
    leftPane.className = 'fm-left-pane';
    leftPane.appendChild(this.toolbar.getElement());
    leftPane.appendChild(this.treePanel.getElement());

    const rightWorkspace = document.createElement('div');
    rightWorkspace.className = 'fm-right-workspace';

    const previewCol = document.createElement('div');
    previewCol.className = 'fm-preview-column';
    previewCol.appendChild(this.previewPane.getElement());

    const binaryCol = document.createElement('div');
    binaryCol.className = 'fm-binary-column';
    binaryCol.appendChild(this.binaryInspector.getElement());

    rightWorkspace.appendChild(previewCol);
    rightWorkspace.appendChild(binaryCol);

    this.container.appendChild(leftPane);
    this.container.appendChild(rightWorkspace);
  }

  public async loadDirectory(dirPath?: string): Promise<void> {
    try {
      const res: ListDirResult = await this.sendFsRequest({
        type: 'fs_list',
        path: dirPath
      });

      if (res.error) {
        alert(`读取目录错误: ${res.error}`);
        return;
      }

      this.currentDir = res.currentPath;
      this.treePanel.updateData(res);
      this.toolbar.updateContext(this.currentDir, this.treePanel.getSelectedItem());
    } catch (err: any) {
      alert(`请求目录失败: ${err.message}`);
    }
  }

  public async refreshCurrentDir(): Promise<void> {
    await this.loadDirectory(this.currentDir);
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
      this.toolbar.updateContext(this.currentDir, this.treePanel.getSelectedItem());
    } catch (err: any) {
      console.error('加载文件预览失败:', err);
    }
  }

  private async saveFile(filePath: string, content: string): Promise<boolean> {
    try {
      const res = await this.sendFsRequest({
        type: 'fs_action',
        action: 'write_file',
        params: { path: filePath, content }
      });
      return res.success;
    } catch {
      return false;
    }
  }

  private promptCreateFile(): void {
    const fileName = prompt('请输入新建文件的名称 (如 app.ts):');
    if (!fileName || !fileName.trim()) return;

    this.sendFsRequest({
      type: 'fs_action',
      action: 'create_file',
      params: { parentDir: this.currentDir, name: fileName.trim() }
    }).then((res) => {
      if (res.success) {
        this.refreshCurrentDir();
        this.loadFilePreview(res.data);
      } else {
        alert(`创建失败: ${res.error}`);
      }
    });
  }

  private promptCreateDir(): void {
    const dirName = prompt('请输入新建文件夹的名称:');
    if (!dirName || !dirName.trim()) return;

    this.sendFsRequest({
      type: 'fs_action',
      action: 'create_dir',
      params: { parentDir: this.currentDir, name: dirName.trim() }
    }).then((res) => {
      if (res.success) {
        this.refreshCurrentDir();
      } else {
        alert(`创建目录失败: ${res.error}`);
      }
    });
  }

  private promptRename(item: FileEntry): void {
    const newName = prompt(`重命名 "${item.name}" 为:`, item.name);
    if (!newName || !newName.trim() || newName.trim() === item.name) return;

    this.sendFsRequest({
      type: 'fs_action',
      action: 'rename',
      params: { oldPath: item.path, newName: newName.trim() }
    }).then((res) => {
      if (res.success) {
        this.refreshCurrentDir();
      } else {
        alert(`重命名失败: ${res.error}`);
      }
    });
  }

  private confirmDelete(item: FileEntry): void {
    const typeLabel = item.isDirectory ? '文件夹（包含内部所有文件）' : '文件';
    if (!confirm(`确定要永久删除 ${typeLabel} "${item.name}" 吗？此操作不可逆！`)) {
      return;
    }

    this.sendFsRequest({
      type: 'fs_action',
      action: 'delete',
      params: { targetPath: item.path }
    }).then((res) => {
      if (res.success) {
        this.treePanel.clearSelection();
        this.previewPane.render(null);
        this.binaryInspector.render(null);
        this.refreshCurrentDir();
      } else {
        alert(`删除失败: ${res.error}`);
      }
    });
  }

  private downloadFile(item: FileEntry): void {
    const authPwd = encodeURIComponent(this.callbacks.getAuthPassword());
    const downloadUrl = `/api/fs/download?path=${encodeURIComponent(item.path)}&pwd=${authPwd}`;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  private copyPath(item: FileEntry | null): void {
    const target = item ? item.path : this.currentDir;
    navigator.clipboard.writeText(target).then(() => {
      alert(`已复制路径到剪贴板:\n${target}`);
    });
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
        if (!result.success) {
          alert(`上传 ${file.name} 失败: ${result.error}`);
        }
      } catch (err: any) {
        alert(`上传 ${file.name} 异常: ${err.message}`);
      }
    }

    this.refreshCurrentDir();
  }

  private sendFsRequest(payload: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const reqId = 'req-' + Math.random().toString(36).substring(2, 9);
      payload.reqId = reqId;

      this.pendingRequests.set(reqId, { resolve, reject });

      // 10 秒超时
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
