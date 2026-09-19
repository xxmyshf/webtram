export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtime: number;
  extension: string;
  permissions: string;
}

export interface ByteStats {
  total: number;
  nullCount: number;
  asciiPrintableCount: number;
  controlCount: number;
  highByteCount: number;
  entropy: number;
  detectedType: string;
}

export interface FileReadResult {
  path: string;
  name: string;
  size: number;
  mtime: number;
  isBinary: boolean;
  textContent?: string;
  truncated: boolean;
  headBytesBase64: string;
  headBytesHex: string[];
  byteStats: ByteStats;
}

export interface ListDirResult {
  currentPath: string;
  parentPath: string | null;
  entries: FileEntry[];
  totalCount: number;
  homeDir?: string;
  error?: string;
}

export type FileActionType = 'create_file' | 'create_dir' | 'rename' | 'delete' | 'batch_delete' | 'copy' | 'write_file';

export interface FileActionParams {
  parentDir?: string;
  name?: string;
  oldPath?: string;
  newName?: string;
  targetPath?: string;
  targetPaths?: string[];
  sourcePath?: string;
  sourcePaths?: string[];
  targetDir?: string;
  path?: string;
  content?: string;
}

export interface ClipboardState {
  mode: 'copy';
  items: FileEntry[];
}

export interface FsActionResponse {
  type: 'fs_action_res';
  reqId: string;
  action: FileActionType;
  success: boolean;
  data?: any;
  error?: string;
}

