import fs from 'fs';
import path from 'path';

// 默认内嵌配置模板
export const DEFAULT_ENV_TEMPLATE = `# ============================================================
# Cyberpunk WebTerm 终端配置 (自动生成)
# ============================================================

# 服务端口
PORT=13399

# 是否启用 HTTPS (true: 开启自签名 HTTPS, false: 纯 HTTP)
ENABLE_HTTPS=true

# 终端鉴权密码的 SHA-256 哈希值 (默认密码: 12345678)
# 前端输入密码后在客户端进行 SHA-256 散列，服务端永不存储明文
TERMINAL_PASSWORD_HASH=ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f

# 语音识别服务 API (默认为内部代理 /api/asr)
ASR_API_URL=/api/asr

# 默认终端 Shell (/bin/bash, /bin/zsh, /bin/sh 等)
DEFAULT_SHELL=/bin/bash

# 终端最大回放行数 (2000行 RingBuffer 现场恢复)
MAX_HISTORY_LINES=2000

# 终端无活动超时断开时间 (分钟)
SESSION_TIMEOUT_MINUTES=30
`;

export interface EmbeddedBinaryEntry {
  ptyNode: string;
  spawnHelper?: string;
}

declare const __WEBTERM_EMBEDDED_INDEX_HTML__: string;
declare const __WEBTERM_EMBEDDED_WEBTERM_JS__: string;
declare const __WEBTERM_EMBEDDED_PTY_BINARIES__: Record<string, EmbeddedBinaryEntry>;
declare const __WEBTERM_EMBEDDED_PTY_NODE_BASE64__: string;

// 这些常量在构建一体化单文件时会被 esbuild define 注入实际内容
export const EMBEDDED_INDEX_HTML = typeof __WEBTERM_EMBEDDED_INDEX_HTML__ !== 'undefined' ? __WEBTERM_EMBEDDED_INDEX_HTML__ : '';
export const EMBEDDED_WEBTERM_JS = typeof __WEBTERM_EMBEDDED_WEBTERM_JS__ !== 'undefined' ? __WEBTERM_EMBEDDED_WEBTERM_JS__ : '';
export const EMBEDDED_PTY_BINARIES: Record<string, EmbeddedBinaryEntry> =
  typeof __WEBTERM_EMBEDDED_PTY_BINARIES__ !== 'undefined' ? __WEBTERM_EMBEDDED_PTY_BINARIES__ : {};
export const EMBEDDED_PTY_NODE_BASE64 = typeof __WEBTERM_EMBEDDED_PTY_NODE_BASE64__ !== 'undefined' ? __WEBTERM_EMBEDDED_PTY_NODE_BASE64__ : '';

/**
 * 确保运行环境目录下的必要文件：
 * 1. 自动生成 .env（如果不存在）
 * 2. 自动生成 ./dist/ 静态托管文件（index.html 和 webterm.js，如果不存在）
 * 3. 自动解压/释放 pty.node（如果环境需要）
 */
export function ensureRuntimeEnvironment(rootDir = process.cwd(), initialPasswordHash?: string | null): void {
  // 1. 检查并生成配置文件 .env
  const localEnvPath = path.resolve(rootDir, '.env.local');
  const envPath = path.resolve(rootDir, '.env');
  if (!fs.existsSync(localEnvPath) && !fs.existsSync(envPath)) {
    try {
      let template = DEFAULT_ENV_TEMPLATE;
      if (initialPasswordHash) {
        template = template.replace(
          /^TERMINAL_PASSWORD_HASH=.*$/m,
          `TERMINAL_PASSWORD_HASH=${initialPasswordHash}`
        );
      }
      fs.writeFileSync(envPath, template, 'utf-8');
      console.log(`[Config] 首次运行，已在当前目录自动生成配置文件: ${envPath}`);
      if (initialPasswordHash) {
        console.log(`[Config] 初始访问密码已配置 (哈希: ${initialPasswordHash.slice(0, 8)}...)`);
      } else {
        console.log(`[Config] 默认访问密码: 12345678 (可在界面右上角锁形图标弹窗随时修改)`);
      }
    } catch (err) {
      console.warn(`[Config] 无法写入配置文件:`, err);
    }
  }

  // 2. 检查并生成前端托管目录 dist/
  const distDir = path.resolve(rootDir, 'dist');
  const indexPath = path.resolve(distDir, 'index.html');
  const jsPath = path.resolve(distDir, 'webterm.js');

  const hasIndex = fs.existsSync(indexPath);
  const hasJs = fs.existsSync(jsPath);

  if (!hasIndex || !hasJs) {
    if (!fs.existsSync(distDir)) {
      try {
        fs.mkdirSync(distDir, { recursive: true });
      } catch {}
    }

    if (!hasIndex && EMBEDDED_INDEX_HTML) {
      try {
        fs.writeFileSync(indexPath, EMBEDDED_INDEX_HTML, 'utf-8');
        console.log(`[Static] 已在当前目录释放前端静态托管入口: ${indexPath}`);
      } catch (err) {
        console.warn(`[Static] 无法写入前端入口文件:`, err);
      }
    }

    if (!hasJs && EMBEDDED_WEBTERM_JS) {
      try {
        fs.writeFileSync(jsPath, EMBEDDED_WEBTERM_JS, 'utf-8');
        console.log(`[Static] 已在当前目录释放前端全资源单 JS: ${jsPath}`);
      } catch (err) {
        console.warn(`[Static] 无法写入前端脚本文件:`, err);
      }
    }
  }
}

/**
 * 确保原生 PTY 二进制可用 (放置在当前执行环境目录下的 build/Release/pty.node 供 node-pty 自动查找)
 * 支持识别当前操作系统平台与架构 (linux-x64, linux-arm64, darwin-arm64, darwin-x64 等)
 * 若发现本地文件与当前架构二进制不一致，自动覆写修复 (自愈)
 */
export function ensureNativePtyBinary(): string | null {
  const currentPlatform = process.platform;
  const rawArch = process.arch as string;
  // 标准化架构标识 (aarch64 -> arm64, x86_64/amd64 -> x64)
  const currentArch = (rawArch === 'aarch64' || rawArch === 'arm64') ? 'arm64' : (rawArch === 'x64' || rawArch === 'amd64') ? 'x64' : rawArch;
  const platformArchKey = `${currentPlatform}-${currentArch}`;

  const entry: EmbeddedBinaryEntry | undefined = EMBEDDED_PTY_BINARIES[platformArchKey];
  const ptyNodeBase64 = entry?.ptyNode || EMBEDDED_PTY_NODE_BASE64;

  if (!ptyNodeBase64) {
    return null;
  }

  const baseDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  const releaseDir = path.resolve(baseDir, 'build/Release');
  const targetFile = path.resolve(releaseDir, 'pty.node');

  try {
    const expectedBuf = Buffer.from(ptyNodeBase64, 'base64');
    let needWrite = true;

    if (fs.existsSync(targetFile)) {
      try {
        const existingBuf = fs.readFileSync(targetFile);
        if (existingBuf.equals(expectedBuf)) {
          needWrite = false;
        } else {
          console.warn(`[PTY] 检测到现有 ${targetFile} 与当前运行架构(${platformArchKey})原生库不匹配，正在自动重新解压自愈...`);
        }
      } catch {
        needWrite = true;
      }
    }

    if (needWrite) {
      fs.mkdirSync(releaseDir, { recursive: true });
      fs.writeFileSync(targetFile, expectedBuf);
      fs.chmodSync(targetFile, 0o755);
      console.log(`[PTY] 已释放适配架构 [${platformArchKey}] 的原生模块至: ${targetFile}`);
    }

    // 如果包含 spawn-helper (如 macOS)，也确保释放
    if (entry?.spawnHelper) {
      const helperFile = path.resolve(releaseDir, 'spawn-helper');
      const helperBuf = Buffer.from(entry.spawnHelper, 'base64');
      let needWriteHelper = true;
      if (fs.existsSync(helperFile)) {
        try {
          const existingHelper = fs.readFileSync(helperFile);
          if (existingHelper.equals(helperBuf)) {
            needWriteHelper = false;
          }
        } catch {}
      }
      if (needWriteHelper) {
        fs.writeFileSync(helperFile, helperBuf);
        fs.chmodSync(helperFile, 0o755);
        console.log(`[PTY] 已释放 spawn-helper 至: ${helperFile}`);
      }
    }

    return targetFile;
  } catch (err) {
    console.warn('[PTY] 释放内嵌原生模块失败:', err);
    return null;
  }
}
