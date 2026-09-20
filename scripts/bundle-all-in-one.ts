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

  // 2. 读取原生 node-pty 二进制模块 (支持多架构: linux-x64, linux-arm64, darwin-arm64, darwin-x64)
  console.log('\n[2/3] 正在内嵌原生 PTY 多平台/多架构二进制资产...');
  const embeddedPtyBinaries: Record<string, { ptyNode: string; spawnHelper?: string }> = {};

  const targets = [
    { platform: 'linux', arch: 'x64', dir: path.join(projectRoot, 'bin/linux-x64') },
    { platform: 'linux', arch: 'arm64', dir: path.join(projectRoot, 'bin/linux-arm64') },
    { platform: 'darwin', arch: 'arm64', dir: path.join(projectRoot, 'bin/darwin-arm64') },
    { platform: 'darwin', arch: 'x64', dir: path.join(projectRoot, 'bin/darwin-x64') },
  ];

  let defaultPtyBase64 = '';

  for (const target of targets) {
    const key = `${target.platform}-${target.arch}`;
    const ptyPath = path.join(target.dir, 'pty.node');
    if (fs.existsSync(ptyPath)) {
      const ptyBuf = fs.readFileSync(ptyPath);
      const entry: { ptyNode: string; spawnHelper?: string } = {
        ptyNode: ptyBuf.toString('base64'),
      };
      const helperPath = path.join(target.dir, 'spawn-helper');
      if (fs.existsSync(helperPath)) {
        entry.spawnHelper = fs.readFileSync(helperPath).toString('base64');
      }
      embeddedPtyBinaries[key] = entry;

      if (!defaultPtyBase64 && target.platform === process.platform && target.arch === process.arch) {
        defaultPtyBase64 = entry.ptyNode;
      }
      console.log(`[PTY] 已嵌入平台架构原生支持: ${key} (pty.node: ${(ptyBuf.length / 1024).toFixed(2)} KB)`);
    } else {
      console.warn(`[PTY] 提示: 未在 ${target.dir} 找到 pty.node`);
    }
  }

  // 兜底：如果没匹配到当前机器架构，取找到的第一个作为 defaultPtyBase64
  if (!defaultPtyBase64 && Object.keys(embeddedPtyBinaries).length > 0) {
    defaultPtyBase64 = Object.values(embeddedPtyBinaries)[0].ptyNode;
  }

  // 3. 打包后端及内嵌资产为一个单 JS 文件
  console.log('\n[3/3] 正在使用 esbuild 打包前后端一体化单文件 (webterm.cjs)...');
  const outputFile = path.join(projectRoot, 'webterm.cjs');

  // esbuild 插件：重写 node-pty/lib/utils.js 中的 loadNativeModule，使之在单文件打包运行环境下直接从 Release/prebuilds 查找并加载释放的原生模块
  const patchNodePtyPlugin: esbuild.Plugin = {
    name: 'patch-node-pty',
    setup(build) {
      build.onLoad({ filter: /node_modules\/node-pty\/lib\/utils\.js$/ }, async (args) => {
        let source = await fs.promises.readFile(args.path, 'utf8');
        source = source.replace(
          /function loadNativeModule\(name\)\s*\{[\s\S]*?\n\}/,
          `function loadNativeModule(name) {
  var path = require("path");
  var baseDir = typeof __dirname !== "undefined" ? __dirname : process.cwd();
  var candidates = [
    path.resolve(baseDir, "build/Release", name + ".node"),
    path.resolve(baseDir, "prebuilds/" + process.platform + "-" + process.arch, name + ".node"),
    path.resolve(process.cwd(), "build/Release", name + ".node"),
    path.resolve(process.cwd(), "prebuilds/" + process.platform + "-" + process.arch, name + ".node")
  ];
  var lastError;
  for (var i = 0; i < candidates.length; i++) {
    var p = candidates[i];
    try {
      return { dir: path.dirname(p), module: require(p) };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error("Failed to load native module: " + name + ".node, checked: " + candidates.join(", ") + ": " + lastError);
}`
        );
        return { contents: source, loader: 'js' };
      });
    }
  };

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
    plugins: [patchNodePtyPlugin],
    define: {
      '__WEBTERM_EMBEDDED_INDEX_HTML__': JSON.stringify(indexHtmlContent),
      '__WEBTERM_EMBEDDED_WEBTERM_JS__': JSON.stringify(webtermJsContent),
      '__WEBTERM_EMBEDDED_PTY_BINARIES__': JSON.stringify(embeddedPtyBinaries),
      '__WEBTERM_EMBEDDED_PTY_NODE_BASE64__': JSON.stringify(defaultPtyBase64)
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
