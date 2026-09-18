import { sha256, isSha256Hex } from './auth.js';

export interface CliArgs {
  port: number | null;
  initialHash: string | null;
  help: boolean;
}

export function parseCliArgs(argv = process.argv.slice(2)): CliArgs {
  let port: number | null = null;
  let initialHash: string | null = null;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    // 1. Port: -p <port>, --port <port>, -p=<port>, --port=<port>
    if (arg === '--port' || arg === '-p') {
      const next = argv[++i];
      if (next) {
        const p = parseInt(next, 10);
        if (!Number.isNaN(p) && p > 0 && p < 65536) port = p;
      }
    } else if (arg.startsWith('--port=')) {
      const p = parseInt(arg.slice('--port='.length), 10);
      if (!Number.isNaN(p) && p > 0 && p < 65536) port = p;
    } else if (arg.startsWith('-p=')) {
      const p = parseInt(arg.slice('-p='.length), 10);
      if (!Number.isNaN(p) && p > 0 && p < 65536) port = p;
    }

    // 2. Password (plaintext): -P <pwd>, --password <pwd>, --pass <pwd>, etc.
    else if (arg === '--password' || arg === '-P' || arg === '--pass') {
      const next = argv[++i];
      if (next !== undefined && next.trim().length > 0) {
        initialHash = sha256(next.trim());
      } else {
        console.warn('[CLI] 警告: 提供的 --password 参数为空，将被忽略。');
      }
    } else if (arg.startsWith('--password=')) {
      const val = arg.slice('--password='.length).trim();
      if (val.length > 0) {
        initialHash = sha256(val);
      } else {
        console.warn('[CLI] 警告: 提供的 --password 参数为空，将被忽略。');
      }
    } else if (arg.startsWith('-P=')) {
      const val = arg.slice('-P='.length).trim();
      if (val.length > 0) {
        initialHash = sha256(val);
      } else {
        console.warn('[CLI] 警告: 提供的 -P 参数为空，将被忽略。');
      }
    } else if (arg.startsWith('--pass=')) {
      const val = arg.slice('--pass='.length).trim();
      if (val.length > 0) {
        initialHash = sha256(val);
      } else {
        console.warn('[CLI] 警告: 提供的 --pass 参数为空，将被忽略。');
      }
    }

    // 3. Password Hash (precomputed SHA-256): --hash <hex>, --password-hash <hex>, etc.
    else if (arg === '--hash' || arg === '--password-hash') {
      const next = argv[++i];
      if (next !== undefined) {
        const trimmed = next.trim().toLowerCase();
        if (isSha256Hex(trimmed)) {
          initialHash = trimmed;
        } else {
          console.warn(`[CLI] 警告: 提供的 --hash 参数 "${next}" 不是合法的 64 位十六进制 SHA-256 哈希，将被忽略。`);
        }
      }
    } else if (arg.startsWith('--hash=')) {
      const val = arg.slice('--hash='.length).trim().toLowerCase();
      if (isSha256Hex(val)) {
        initialHash = val;
      } else {
        console.warn(`[CLI] 警告: 提供的 --hash 参数 "${val}" 不是合法的 64 位十六进制 SHA-256 哈希，将被忽略。`);
      }
    } else if (arg.startsWith('--password-hash=')) {
      const val = arg.slice('--password-hash='.length).trim().toLowerCase();
      if (isSha256Hex(val)) {
        initialHash = val;
      } else {
        console.warn(`[CLI] 警告: 提供的 --password-hash 参数 "${val}" 不是合法的 64 位十六进制 SHA-256 哈希，将被忽略。`);
      }
    }
  }

  // 4. Fallback to environment variables if not specified on CLI
  if (!initialHash) {
    const envHash = process.env.WEBTERM_PASSWORD_HASH || process.env.TERMINAL_PASSWORD_HASH;
    if (envHash && isSha256Hex(envHash.trim())) {
      initialHash = envHash.trim().toLowerCase();
    } else {
      const envPlain = process.env.WEBTERM_PASSWORD || process.env.TERMINAL_PASSWORD;
      if (envPlain && envPlain.trim().length > 0) {
        initialHash = sha256(envPlain.trim());
      }
    }
  }

  return { port, initialHash, help };
}

export function printHelp(): void {
  console.log(`
⚡ Cyberpunk WebTerm // 极简全栈终端服务

使用方式:
  node webterm.cjs [选项]
  ./webterm.cjs [选项]

选项:
  -p, --port <端口>              指定服务监听端口 (默认: 13399 或 PORT 环境变量)
  -P, --password <明文密码>      指定初始/覆盖访问密码 (自动进行 SHA-256 散列并持久化)
      --hash <64位哈希>          指定初始/覆盖访问密码的 SHA-256 哈希值
  -h, --help                     显示此帮助信息并退出

环境变量支持:
  PORT                           服务端口 (如: PORT=8080)
  ENABLE_HTTPS                   是否开启 HTTPS (true/false, 默认: true)
  TERMINAL_PASSWORD              明文初始密码 (自动转为哈希)
  TERMINAL_PASSWORD_HASH         64位 SHA-256 密码哈希值

示例:
  # 使用默认密码 12345678 启动
  node webterm.cjs

  # 指定自定义访问密码和自定义端口
  node webterm.cjs -P mysecret123 --port 8080

  # 使用预计算的 SHA-256 哈希启动 (推荐在运维自动化脚本中使用，避免明文留痕)
  node webterm.cjs --hash ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f
`);
}
