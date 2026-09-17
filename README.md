# WebTerm // Cyberpunk Hacker Web 终端系统

基于 **Xterm.js** + **Node.js PTY** 构建的高性能全功能 Web 命令行终端系统。具备赛博朋克极客暗黑质感、PTY 会话断线与刷新无缝恢复（Session Resume）、专属定制的虚拟触控键盘以及长按空格实时语音识别（ASR）交互系统。

---

## ✨ 核心特性

### 1. Cyberpunk Hacker / Geek Modern 视觉与交互体系
- **暗黑深空色调**：以 `#090d13` / `#0d1117` 为极黑底色，终端底色 `#0b0e14`，前景色采用冷白 `#e6edf3` 与赛博青 `#00e5ff` / 荧光绿 `#00ff9f`。
- **发光呼吸动效**：终端光标与按键选中态具备霓虹青色辉光呼吸效果（Glow Effect）。
- **极简状态药丸**：顶部实时指示连接状态（在线绿色脉冲、重连中黄色告警、离线红灯）与毫秒级 Ping 往返延迟。
- **等宽编程字体栈**：优先加载 `JetBrains Mono`、`Fira Code`、`Cascadia Code`，开启等宽连字（Font Ligatures）支持。
- **毛玻璃亚克力质感**：面板与虚拟键盘采用 `backdrop-filter: blur(20px)`，边缘具有 `1px solid rgba(0, 229, 255, 0.25)` 半透明高亮细线。

### 2. 专属定制虚拟触控键盘 (Custom Virtual Touch Keyboard)
- **CLI 专属快捷栏 (Row 1)**：
  - 集成高频运维按键：`Esc`、`Ctrl+C`、`Tab`（命令补全）、`Ctrl+D`、`|`（管道符）、`-`、`~`、`/`、方向键 `↑` `↓`。
  - **方向键连续滚动**：长按 `↑` 或 `↓` 自动连续触发历史命令翻动。
  - **Ctrl 锁存模式 (Latch Mode)**：点击一次进入高亮锁存待触发状态，下一个按键（例如 `l` 清屏、`c` 中断）将自动与 Ctrl 组合发送并随后自动解除。
- **主键盘与分层布局**：
  - **按键微拟物倒角**：Border Radius 6px，按压时平滑缩放至 0.94，伴随青光辉光与 `navigator.vibrate(15)` 机械短促微震动。
  - **Caps / Shift**：单次点击临时大写，双击锁定 CapsLock（右上角绿色 LED 状态灯亮起）。
  - **模式切换**：通过 `?123` / `ABC` 快捷在字母模式与数字/特殊符号小键盘之间平滑切换。
  - **折叠与展开**：支持一键收起抽屉，同时适配移动端安全区 `env(safe-area-inset-bottom)`。

### 3. 长按空格语音输入 (ASR Voice Input)
- **空格键时序与识别**：
  - 宽幅空格键标识：`Space (按住说话)`。
  - 短按（< 400ms）：直接作为标准空格 `' '` 写入终端。
  - 长按（>= 400ms）：触发 `navigator.vibrate(30)` 震动，激活全息声波 HUD。
- **手势取消与全息 HUD**：
  - 屏幕中央浮现磨砂玻璃 HUD 弹窗，Canvas 实时绘制随音量起伏的呼吸声波。
  - **上滑取消**：手指向上滑动超过 50px，HUD 瞬间变红并提示“松开取消发送”；滑回则恢复。
- **音频采集与服务端点**：
  - Web Audio API 实时采集 16kHz PCM 并编码为标准 WAV 格式。
  - 动态可配置：支持通过 `window.TERMINAL_CONFIG = { asrApiUrl: '/api/asr' }` 指定自定义 ASR 识别后端，可无缝对接本地智能解析或 OpenAI Whisper 服务。

### 4. PTY 会话持久化与恢复 (Session Resume)
- 客户端将会话 ID (`sessionId`) 存入 `localStorage`，刷新页面或网络闪断重连时保持后端进程不被销毁。
- 后端基于 `node-pty` 管理常驻进程，配备 2000 行环形缓冲区（RingBuffer），重连时瞬间全量重放，工作流完整无缝衔接。
- 视口自适应：集成 `@xterm/addon-fit`，虚拟键盘弹出或视口变化时动态重置 `cols` 与 `rows` 并同步至后端。

### 5. 密码访问验证 (Access Key Security)
- 服务端通过环境变量 `TERMINAL_PASSWORD` 配置访问密钥（默认为 `cyberpunk2026`）。
- 首次进入或未授权时弹出赛博风格认证卡片，验证通过后建立 PTY 会话与数据管道。

---

## 🚀 快速启动

### 1. 安装依赖
```bash
npm install
```

### 2. 配置文件说明 (`.env`)
在项目根目录下配置 `.env` 文件：
```ini
PORT=3000
TERMINAL_PASSWORD=cyberpunk2026
DEFAULT_SHELL=/bin/bash
MAX_HISTORY_LINES=2000
SESSION_TIMEOUT_MINUTES=30
```

### 3. 运行服务
- **一键启动生产服务**：
  ```bash
  npm run build
  npm run server
  ```
  访问 `http://localhost:3000` 即可进入终端。默认访问密码为 `cyberpunk2026`。

- **开发热重载模式**：
  - 后端服务：`npm run server` (端口 3000)
  - 前端开发：`npm run dev` (端口 5173，内置 WebSocket 与 API 代理)

### 4. 运行全自动化测试套件
```bash
npx tsx scripts/test-system.ts
```
该测试会全自动覆盖：HTTP 健康检查、密码鉴权拦截、ASR 音频端点解析、WebSocket 认证、PTY 进程交互与断线重连 2000 行 RingBuffer 会话恢复验证。
