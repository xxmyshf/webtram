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
TERMINAL_PASSWORD_HASH=0964b6086f4cb7e39d73fc144f8396c21eef00c9eaefd628eb9265f2425cf8c6

# 语音识别服务 API (默认为内部代理 /api/asr)
ASR_API_URL=/api/asr

# 默认终端 Shell (/bin/bash, /bin/zsh, /bin/sh 等)
DEFAULT_SHELL=/bin/bash

# 终端最大回放行数 (2000行 RingBuffer 现场恢复)
MAX_HISTORY_LINES=2000

# 终端无活动超时断开时间 (分钟)
SESSION_TIMEOUT_MINUTES=30
`;

declare const __WEBTERM_EMBEDDED_INDEX_HTML__: string;
declare const __WEBTERM_EMBEDDED_WEBTERM_JS__: string;
declare const __WEBTERM_EMBEDDED_PTY_NODE_BASE64__: string;

// 这些常量在构建一体化单文件时会被 esbuild define 注入实际内容
export const EMBEDDED_INDEX_HTML = typeof __WEBTERM_EMBEDDED_INDEX_HTML__ !== 'undefined' ? __WEBTERM_EMBEDDED_INDEX_HTML__ : '';
export const EMBEDDED_WEBTERM_JS = typeof __WEBTERM_EMBEDDED_WEBTERM_JS__ !== 'undefined' ? __WEBTERM_EMBEDDED_WEBTERM_JS__ : '';
export const EMBEDDED_PTY_NODE_BASE64 = typeof __WEBTERM_EMBEDDED_PTY_NODE_BASE64__ !== 'undefined' ? __WEBTERM_EMBEDDED_PTY_NODE_BASE64__ : '';

/**
 * 确保运行环境目录下的必要文件：
 * 1. 自动生成 .env（如果不存在）
 * 2. 自动生成 ./dist/ 静态托管文件（index.html 和 webterm.js，如果不存在）
 * 3. 自动解压/释放 pty.node（如果环境需要）
 */
export function ensureRuntimeEnvironment(rootDir = process.cwd()): void {
  // 1. 检查并生成配置文件 .env
  const localEnvPath = path.resolve(rootDir, '.env.local');
  const envPath = path.resolve(rootDir, '.env');
  if (!fs.existsSync(localEnvPath) && !fs.existsSync(envPath)) {
    try {
      fs.writeFileSync(envPath, DEFAULT_ENV_TEMPLATE, 'utf-8');
      console.log(`[Config] 首次运行，已在当前目录自动生成配置文件: ${envPath}`);
      console.log(`[Config] 默认访问密码: 12345678 (可在界面右上角锁形图标弹窗随时修改)`);
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
 */
export function ensureNativePtyBinary(): string | null {
  if (EMBEDDED_PTY_NODE_BASE64) {
    const baseDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
    const releaseDir = path.resolve(baseDir, 'build/Release');
    const targetFile = path.resolve(releaseDir, 'pty.node');

    if (!fs.existsSync(targetFile)) {
      try {
        fs.mkdirSync(releaseDir, { recursive: true });
        const buf = Buffer.from(EMBEDDED_PTY_NODE_BASE64, 'base64');
        fs.writeFileSync(targetFile, buf);
        fs.chmodSync(targetFile, 0o755);
      } catch (err) {
        console.warn('[PTY] 释放内嵌原生模块失败:', err);
        return null;
      }
    }
    return targetFile;
  }
  return null;
}
