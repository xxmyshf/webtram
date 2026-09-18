import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

async function bundleAllInOne() {
  console.log('==================================================');
  console.log('📦 开始构建 Cyberpunk WebTerm 全栈一体化单 JS ...');
  console.log('==================================================');

  // 1. 构建前端产物
  console.log('\n[1/3] 正在构建前端单 JS 资源 (Vite)...');
  execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });

  const distDir = path.join(projectRoot, 'dist');
  const indexPath = path.join(distDir, 'index.html');
  const jsPath = path.join(distDir, 'webterm.js');

  if (!fs.existsSync(indexPath) || !fs.existsSync(jsPath)) {
    throw new Error('前端构建未生成预期的 dist/index.html 或 dist/webterm.js');
  }

  const indexHtmlContent = fs.readFileSync(indexPath, 'utf-8');
  const webtermJsContent = fs.readFileSync(jsPath, 'utf-8');
  console.log(`[Frontend] 已读取 index.html (${(indexHtmlContent.length / 1024).toFixed(2)} KB) 与 webterm.js (${(webtermJsContent.length / 1024).toFixed(2)} KB)`);

  // 2. 读取原生 node-pty 二进制模块 (如果存在)
  console.log('\n[2/3] 正在内嵌原生 PTY 二进制资产...');
  let ptyNodeBase64 = '';
  const ptyNodePath = path.join(projectRoot, 'node_modules/node-pty/build/Release/pty.node');
  if (fs.existsSync(ptyNodePath)) {
    const ptyBuf = fs.readFileSync(ptyNodePath);
    ptyNodeBase64 = ptyBuf.toString('base64');
    console.log(`[PTY] 已成功内嵌原生模块 pty.node (${(ptyBuf.length / 1024).toFixed(2)} KB)`);
  } else {
    console.warn('[PTY] 提示: 未在构建环境中找到 pty.node, 运行时将尝试调用系统的 node-pty');
  }

  // 3. 打包后端及内嵌资产为一个单 JS 文件
  console.log('\n[3/3] 正在使用 esbuild 打包前后端一体化单文件 (webterm.cjs)...');
  const outputFile = path.join(projectRoot, 'webterm.cjs');

  await esbuild.build({
    entryPoints: [path.join(projectRoot, 'server/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: outputFile,
    banner: {
      js: '#!/usr/bin/env node\n'
    },
    external: ['*.node'],
    define: {
      '__WEBTERM_EMBEDDED_INDEX_HTML__': JSON.stringify(indexHtmlContent),
      '__WEBTERM_EMBEDDED_WEBTERM_JS__': JSON.stringify(webtermJsContent),
      '__WEBTERM_EMBEDDED_PTY_NODE_BASE64__': JSON.stringify(ptyNodeBase64)
    },
    minify: false, // 保持代码可读可调试
    sourcemap: false
  });

  // 赋予执行权限
  try {
    fs.chmodSync(outputFile, 0o755);
  } catch {}

  const stats = fs.statSync(outputFile);
  console.log('\n==================================================');
  console.log('🎉 全栈一体化单文件打包成功！');
  console.log(`📁 产物路径: ${outputFile}`);
  console.log(`📊 产物体积: ${(stats.size / 1024 / 1024).toFixed(2)} MB (${stats.size.toLocaleString()} bytes)`);
  console.log('==================================================');
  console.log('\n🚀 运行方式:');
  console.log('   node webterm.cjs');
  console.log('   (或者: ./webterm.cjs)');
  console.log('\n💡 运行特性:');
  console.log('   1. 运行它会自动启动 HTTPS/WebSocket/PTY 服务');
  console.log('   2. 自动在当前工作目录下检查并生成 .env 配置文件 (如果不存在)');
  console.log('   3. 自动在当前工作目录下检查并生成 ./dist/ 静态托管文件 (如果不存在)');
  console.log('   4. 自动生成 SSL/TLS 自签名证书并开箱即用');
  console.log('==================================================\n');
}

bundleAllInOne().catch((err) => {
  console.error('❌ 打包失败:', err);
  process.exit(1);
});
