import { ensureNativePtyBinary } from './embedded-assets.js';
import type * as nodePtyType from 'node-pty';
import { createRequire } from 'module';

declare const require: any;
const nodeRequire = (typeof require === 'function')
  ? require
  : createRequire(typeof import.meta !== 'undefined' && import.meta.url ? import.meta.url : `file://${process.cwd()}/`);

let ptyModule: typeof nodePtyType | null = null;

export function getPty(): typeof nodePtyType {
  if (ptyModule) return ptyModule;

  // 1. 确保在载入 node-pty 前，原生的 pty.node 已释放至 build/Release/ 与 prebuilds/
  ensureNativePtyBinary();

  // 2. 动态 require 已被 esbuild 打包进 bundle 的 node-pty
  // 通过 require('node-pty') 触发 node-pty 顶层模块的初始化与 loadNativeModule
  ptyModule = nodeRequire('node-pty');
  return ptyModule!;
}

export type IPty = nodePtyType.IPty;
