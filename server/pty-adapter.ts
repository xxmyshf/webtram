import { createRequire } from 'node:module';
import { ensureNativePtyBinary } from './embedded-assets.js';
import type * as nodePtyType from 'node-pty';

const esmRequire = typeof require !== 'undefined'
  ? require
  : createRequire(import.meta.url);

let ptyModule: typeof nodePtyType | null = null;

export function getPty(): typeof nodePtyType {
  if (ptyModule) return ptyModule;

  // 1. 确保在载入 node-pty 前，原生的 pty.node 已释放至 build/Release/ 与 prebuilds/
  ensureNativePtyBinary();

  // 2. 加载 node-pty
  ptyModule = esmRequire('node-pty');
  return ptyModule!;
}

export type IPty = nodePtyType.IPty;
