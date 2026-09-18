import { ensureNativePtyBinary } from './embedded-assets.js';
import { createRequire } from 'module';
import path from 'path';

function getReq(): NodeRequire {
  if (typeof require !== 'undefined') {
    return require;
  }
  // ESM 环境下使用 createRequire 解析
  return createRequire(path.resolve(process.cwd(), 'package.json'));
}

let ptyInstance: any = null;

export function getPty(): any {
  if (ptyInstance) return ptyInstance;

  const req = getReq();

  // 1. 优先尝试直接 require 系统/当前目录的 node-pty
  try {
    ptyInstance = req('node-pty');
    return ptyInstance;
  } catch (err) {
    // 降级使用内嵌原生二进制
  }

  // 2. 释放内嵌原生模块并再次加载
  ensureNativePtyBinary();

  try {
    ptyInstance = req('node-pty');
    return ptyInstance;
  } catch (err) {
    console.error('[PTY] 载入 node-pty 失败:', err);
    throw err;
  }
}

export type IPty = any;
