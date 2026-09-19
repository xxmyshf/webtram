import fs from 'fs';
import path from 'path';
import os from 'os';

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
}

export class FsManager {
  private rootDir: string;

  constructor(rootDir?: string) {
    this.rootDir = rootDir || process.env.WEBTERM_FS_ROOT || process.env.HOME || os.homedir();
  }

  public getRootDir(): string {
    return this.rootDir;
  }

  /**
   * 规范化并解析目标路径 (严格支持当前用户的真实 Home 目录 ~ 自动展开)
   */
  public resolvePath(targetPath?: string): string {
    const userHome = process.env.HOME || os.homedir();
    if (!targetPath || targetPath.trim() === '' || targetPath.trim() === '~') {
      return userHome;
    }
    const trimmed = targetPath.trim();
    if (trimmed === '~') {
      return userHome;
    }
    if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
      return path.resolve(userHome, trimmed.slice(2));
    }
    if (trimmed === '.' || trimmed === './') {
      return userHome;
    }
    const resolved = path.isAbsolute(trimmed)
      ? path.resolve(trimmed)
      : path.resolve(this.rootDir, trimmed);
    return resolved;
  }

  /**
   * 列出目录内容
   */
  public listDirectory(dirPath?: string, showHidden = true): ListDirResult {
    const resolved = this.resolvePath(dirPath);

    if (!fs.existsSync(resolved)) {
      throw new Error(`目录不存在: ${resolved}`);
    }

    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      throw new Error(`路径不是目录: ${resolved}`);
    }

    const dirEntries = fs.readdirSync(resolved, { withFileTypes: true });
    const entries: FileEntry[] = [];

    for (const ent of dirEntries) {
      if (!showHidden && ent.name.startsWith('.') && ent.name !== '.' && ent.name !== '..') {
        continue;
      }

      const fullPath = path.join(resolved, ent.name);
      try {
        const itemStat = fs.statSync(fullPath);
        const isDir = ent.isDirectory();
        const isSymlink = ent.isSymbolicLink();
        const ext = isDir ? '' : path.extname(ent.name).toLowerCase();
        const mode = (itemStat.mode & 0o777).toString(8);

        entries.push({
          name: ent.name,
          path: fullPath,
          isDirectory: isDir,
          isSymlink: isSymlink,
          size: itemStat.size,
          mtime: itemStat.mtimeMs,
          extension: ext,
          permissions: mode
        });
      } catch {
        // 特殊设备文件或无权读取文件，降级处理
        entries.push({
          name: ent.name,
          path: fullPath,
          isDirectory: ent.isDirectory(),
          isSymlink: ent.isSymbolicLink(),
          size: 0,
          mtime: Date.now(),
          extension: path.extname(ent.name).toLowerCase(),
          permissions: '000'
        });
      }
    }

    // 目录优先，其次按名称字母排序
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

    const parentPath = resolved === path.parse(resolved).root ? null : path.dirname(resolved);

    return {
      currentPath: resolved,
      parentPath,
      entries,
      totalCount: entries.length,
      homeDir: process.env.HOME || os.homedir()
    };
  }

  /**
   * 读取文件信息及前 300 字节二进制数据分析
   */
  public readFile(filePath: string, maxTextBytes = 512 * 1024): FileReadResult {
    const resolved = this.resolvePath(filePath);

    if (!fs.existsSync(resolved)) {
      throw new Error(`文件不存在: ${resolved}`);
    }

    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      throw new Error(`路径是目录，无法作为文件读取: ${resolved}`);
    }

    const fileSize = stat.size;
    const name = path.basename(resolved);

    // 1. 读取前 300 字节用于二进制与可视化渲染
    const headLen = Math.min(300, fileSize);
    const headBuf = Buffer.alloc(headLen);

    if (headLen > 0) {
      const fd = fs.openSync(resolved, 'r');
      fs.readSync(fd, headBuf, 0, headLen, 0);
      fs.closeSync(fd);
    }

    const headBytesHex: string[] = [];
    for (let i = 0; i < headBuf.length; i++) {
      headBytesHex.push(headBuf[i].toString(16).padStart(2, '0'));
    }

    const byteStats = this.analyzeBytes(headBuf);

    // 2. 检测是否为二进制文件
    let isBinary = false;
    // 如果包含 Null 字节或控制字符占比异常高，判定为二进制
    if (byteStats.nullCount > 0 || (byteStats.highByteCount + byteStats.controlCount) / (byteStats.total || 1) > 0.3) {
      isBinary = true;
    }

    // 3. 如果是文本文件，读取部分或完整内容供预览
    let textContent: string | undefined = undefined;
    let truncated = false;

    if (!isBinary) {
      try {
        const readLen = Math.min(fileSize, maxTextBytes);
        const textBuf = Buffer.alloc(readLen);
        const fd = fs.openSync(resolved, 'r');
        fs.readSync(fd, textBuf, 0, readLen, 0);
        fs.closeSync(fd);

        textContent = textBuf.toString('utf-8');
        truncated = fileSize > maxTextBytes;
      } catch {
        isBinary = true;
      }
    }

    return {
      path: resolved,
      name,
      size: fileSize,
      mtime: stat.mtimeMs,
      isBinary,
      textContent,
      truncated,
      headBytesBase64: headBuf.toString('base64'),
      headBytesHex,
      byteStats
    };
  }

  /**
   * 分析字节特征与统计数据
   */
  private analyzeBytes(buf: Buffer): ByteStats {
    let nullCount = 0;
    let asciiPrintableCount = 0;
    let controlCount = 0;
    let highByteCount = 0;

    const freqMap = new Array(256).fill(0);

    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      freqMap[b]++;

      if (b === 0) {
        nullCount++;
      } else if (b >= 32 && b <= 126) {
        asciiPrintableCount++;
      } else if ((b >= 7 && b <= 13) || b === 27) {
        // \t, \n, \r 等常用控制符
        asciiPrintableCount++;
      } else if (b < 32) {
        controlCount++;
      } else {
        highByteCount++;
      }
    }

    // 计算信息熵 Shannon Entropy (0.0 ~ 8.0)
    let entropy = 0;
    if (buf.length > 0) {
      for (let i = 0; i < 256; i++) {
        if (freqMap[i] > 0) {
          const p = freqMap[i] / buf.length;
          entropy -= p * Math.log2(p);
        }
      }
    }

    const detectedType = this.detectMagicType(buf);

    return {
      total: buf.length,
      nullCount,
      asciiPrintableCount,
      controlCount,
      highByteCount,
      entropy: parseFloat(entropy.toFixed(2)),
      detectedType
    };
  }

  /**
   * 魔数与文件类型特征检测
   */
  private detectMagicType(buf: Buffer): string {
    if (buf.length < 2) return '空文件/未知';

    // ELF
    if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
      const is64 = buf[4] === 2;
      const machine = buf.length >= 19 ? buf.readUInt16LE(18) : 0;
      let archStr = 'Generic';
      if (machine === 62) archStr = 'x86_64';
      else if (machine === 183) archStr = 'AArch64/ARM64';
      else if (machine === 40) archStr = 'ARM';
      else if (machine === 3) archStr = 'x86';
      return `Linux ELF ${is64 ? '64-bit' : '32-bit'} (${archStr})`;
    }

    // Mach-O
    if ((buf[0] === 0xfe && buf[1] === 0xed && buf[2] === 0xfa && buf[3] === 0xcf) ||
        (buf[0] === 0xcf && buf[1] === 0xfa && buf[2] === 0xed && buf[3] === 0xfe)) {
      return 'macOS Mach-O 64-bit Binary';
    }
    if ((buf[0] === 0xca && buf[1] === 0xfe && buf[2] === 0xba && buf[3] === 0xbe)) {
      return 'Mach-O Universal / Java Class';
    }

    // Windows PE
    if (buf[0] === 0x4d && buf[1] === 0x5a) {
      return 'Windows PE Executable / DLL (MZ)';
    }

    // Images
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return 'PNG Image';
    }
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      return 'JPEG Image';
    }
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
      return 'GIF Image';
    }
    if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      return 'WebP Image';
    }

    // Documents / Archives
    if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
      return 'PDF Document';
    }
    if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
      return 'ZIP / JAR / Office Archive';
    }
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      return 'GZIP Compressed Archive';
    }
    if (buf[0] === 0x42 && buf[1] === 0x5a && buf[2] === 0x68) {
      return 'BZIP2 Compressed Archive';
    }
    if (buf[0] === 0xfd && buf[1] === 0x37 && buf[2] === 0x7a && buf[3] === 0x58 && buf[4] === 0x5a && buf[5] === 0x00) {
      return 'XZ Compressed Archive';
    }
    if (buf[0] === 0x52 && buf[1] === 0x61 && buf[2] === 0x72 && buf[3] === 0x21) {
      return 'RAR Archive';
    }
    if (buf[0] === 0x77 && buf[1] === 0x4f && buf[2] === 0x46 && buf[3] === 0x46) {
      return 'WOFF Font';
    }
    if (buf[0] === 0x77 && buf[1] === 0x4f && buf[2] === 0x46 && buf[3] === 0x32) {
      return 'WOFF2 Font';
    }

    // Scripts / Text
    if (buf[0] === 0x23 && buf[1] === 0x21) {
      return 'Unix Executable Script (#!)';
    }
    const sample = buf.toString('utf-8', 0, Math.min(buf.length, 64)).trim();
    if (sample.startsWith('{') || sample.startsWith('[')) {
      return 'JSON Data';
    }
    if (sample.toLowerCase().startsWith('<!doctype html') || sample.toLowerCase().startsWith('<html')) {
      return 'HTML Document';
    }
    if (sample.startsWith('<?xml')) {
      return 'XML Document';
    }

    return '通用二进制/文本数据';
  }

  /**
   * 执行高频文件操作
   */
  public createFile(parentDir: string, fileName: string, initialContent = ''): string {
    const resolvedParent = this.resolvePath(parentDir);
    const target = path.join(resolvedParent, fileName);
    if (fs.existsSync(target)) {
      throw new Error(`文件已存在: ${fileName}`);
    }
    fs.writeFileSync(target, initialContent, 'utf-8');
    return target;
  }

  public createDirectory(parentDir: string, dirName: string): string {
    const resolvedParent = this.resolvePath(parentDir);
    const target = path.join(resolvedParent, dirName);
    if (fs.existsSync(target)) {
      throw new Error(`文件夹已存在: ${dirName}`);
    }
    fs.mkdirSync(target, { recursive: true });
    return target;
  }

  public rename(oldPath: string, newName: string): string {
    const resolvedOld = this.resolvePath(oldPath);
    if (!fs.existsSync(resolvedOld)) {
      throw new Error(`原文件不存在: ${oldPath}`);
    }
    const parent = path.dirname(resolvedOld);
    const resolvedNew = path.join(parent, newName);
    if (fs.existsSync(resolvedNew)) {
      throw new Error(`目标文件已存在: ${newName}`);
    }
    fs.renameSync(resolvedOld, resolvedNew);
    return resolvedNew;
  }

  public delete(targetPath: string): void {
    const resolved = this.resolvePath(targetPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`文件不存在: ${targetPath}`);
    }
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      fs.rmSync(resolved, { recursive: true, force: true });
    } else {
      fs.unlinkSync(resolved);
    }
  }

  public batchDelete(targetPaths: string[]): { successCount: number; errors: string[] } {
    let successCount = 0;
    const errors: string[] = [];
    for (const p of targetPaths) {
      try {
        this.delete(p);
        successCount++;
      } catch (err: any) {
        errors.push(`${path.basename(p)}: ${err.message}`);
      }
    }
    return { successCount, errors };
  }

  public copy(sourcePath: string, targetDir: string): string {
    const resolvedSource = this.resolvePath(sourcePath);
    const resolvedTargetDir = this.resolvePath(targetDir);

    if (!fs.existsSync(resolvedSource)) {
      throw new Error(`源文件不存在: ${sourcePath}`);
    }
    if (!fs.existsSync(resolvedTargetDir)) {
      throw new Error(`目标目录不存在: ${targetDir}`);
    }

    const baseName = path.basename(resolvedSource);
    let targetPath = path.join(resolvedTargetDir, baseName);

    // 冲突处理：若目标路径已存在，则生成 "name (copy).ext" 或 "name (copy 2).ext"
    if (fs.existsSync(targetPath)) {
      const ext = path.extname(baseName);
      const nameWithoutExt = path.basename(baseName, ext);
      let counter = 1;
      let candidate = `${nameWithoutExt} (copy)${ext}`;
      while (fs.existsSync(path.join(resolvedTargetDir, candidate))) {
        counter++;
        candidate = `${nameWithoutExt} (copy ${counter})${ext}`;
      }
      targetPath = path.join(resolvedTargetDir, candidate);
    }

    const stat = fs.statSync(resolvedSource);
    if (stat.isDirectory()) {
      fs.cpSync(resolvedSource, targetPath, { recursive: true });
    } else {
      fs.copyFileSync(resolvedSource, targetPath);
    }
    return targetPath;
  }

  public batchCopy(sourcePaths: string[], targetDir: string): { copiedPaths: string[]; errors: string[] } {
    const copiedPaths: string[] = [];
    const errors: string[] = [];
    for (const p of sourcePaths) {
      try {
        const res = this.copy(p, targetDir);
        copiedPaths.push(res);
      } catch (err: any) {
        errors.push(`${path.basename(p)}: ${err.message}`);
      }
    }
    return { copiedPaths, errors };
  }

  public writeFile(filePath: string, content: string | Buffer): void {
    const resolved = this.resolvePath(filePath);
    fs.writeFileSync(resolved, content);
  }
}
