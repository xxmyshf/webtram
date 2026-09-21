import { ensureNativePtyBinary } from './embedded-assets.js';
import type * as nodePtyType from 'node-pty';

let ptyModule: typeof nodePtyType | null = null;

export function getPty(): typeof nodePtyType {
  if (ptyModule) return ptyModule;

  // 1. 确保在载入 node-pty 前，原生的 pty.node 已释放至 build/Release/ 与 prebuilds/
  ensureNativePtyBinary();

  // 2. 直接使用 require('node-pty')，esbuild 打包时会静态分析并完整内嵌 node-pty 的全部 JS 逻辑
  ptyModule = require('node-pty');
  return ptyModule!;
}

export type IPty = nodePtyType.IPty;
