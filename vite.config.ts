import { defineConfig, Plugin } from 'vite';

function singleJsPlugin(): Plugin {
  return {
    name: 'vite-plugin-single-js',
    enforce: 'post',
    generateBundle(_options, bundle) {
      let cssCode = '';
      const cssFiles: string[] = [];

      // 收集所有打包出的 CSS 文件内容
      for (const [fileName, file] of Object.entries(bundle)) {
        if (fileName.endsWith('.css') && file.type === 'asset') {
          cssCode += file.source.toString() + '\n';
          cssFiles.push(fileName);
          delete bundle[fileName];
        }
      }

      // 将 CSS 注入到唯一的入口 JS chunk 中
      for (const [_fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'chunk' && chunk.isEntry) {
          const cssInjection = `(function(){try{if(typeof document!=="undefined"){var el=document.getElementById("webterm-style");if(!el){el=document.createElement("style");el.id="webterm-style";el.type="text/css";el.textContent=${JSON.stringify(cssCode)};document.head.appendChild(el);}}}catch(e){console.error("Failed to inject WebTerm styles:",e);}})();\n`;
          chunk.code = cssInjection + chunk.code;
        }
      }

      // 如果有 index.html，清理其中的 CSS link 引用
      for (const [fileName, file] of Object.entries(bundle)) {
        if (fileName.endsWith('.html') && file.type === 'asset') {
          let html = file.source.toString();
          html = html.replace(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi, '');
          file.source = html;
        }
      }
    }
  };
}

export default defineConfig({
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:13399',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:13399',
        ws: true
      }
    }
  },
  plugins: [singleJsPlugin()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    rollupOptions: {
      output: {
        codeSplitting: false,
        entryFileNames: 'webterm.js',
        chunkFileNames: 'webterm-[name].js',
        assetFileNames: '[name].[ext]'
      }
    }
  }
});
