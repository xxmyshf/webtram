import { ensureNativePtyBinary } from './embedded-assets.js';
import type * as nodePtyType from 'node-pty';

let ptyInstance: typeof nodePtyType | null = null;

export function getPty(): typeof nodePtyType {
  if (ptyInstance) return ptyInstance;
  // 1. 确保在载入原生模块前，当前平台的 pty.node 已释放至本地
  ensureNativePtyBinary();
  // 2. 惰性触发 node-pty 模块求值 (esbuild 将其编译为 require_lib() 内联调用)
  ptyInstance = require('node-pty');
  return ptyInstance!;
}

export type IPty = nodePtyType.IPty;

