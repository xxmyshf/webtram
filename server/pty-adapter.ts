import { ensureNativePtyBinary } from './embedded-assets.js';
import type * as nodePtyType from 'node-pty';

import { createRequire } from 'module';
const reqFn = typeof globalThis.require === 'function'
  ? globalThis.require
  : (typeof __filename !== 'undefined' ? createRequire(__filename) : createRequire(process.cwd() + '/index.js'));
let ptyInstance: typeof nodePtyType | null = null;

export function getPty(): typeof nodePtyType {
  if (ptyInstance) return ptyInstance;

  // 1. 确保释放内嵌的原生 pty.node 二进制到 build/Release/pty.node
  ensureNativePtyBinary();

  // 2. 加载 node-pty (esbuild 会将 node-pty 的 JS 代码完整打包进 bundle)
  try {
    ptyInstance = reqFn('node-pty');
    return ptyInstance!;
  } catch (err) {
    console.error('[PTY] 载入 node-pty 失败:', err);
    throw err;
  }
}

export type IPty = nodePtyType.IPty;
