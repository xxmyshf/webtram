---
name: webterm
description: >-
  启动、管理并操作 Cyberpunk WebTerm 终端服务。具备多端持久化会话、断线自动重连、2000行 RingBuffer 历史恢复、
  全双工 WebSocket 同步、手机端横屏全键盘及语音输入等特性。让大模型可在后台持久运行任务，同时允许用户通过手机等移动端 Web
  随时访问、查看历史并保留上下文继续操作。
---

# Cyberpunk WebTerm Agent Skill

本 Skill 规范了 AI 智能体（LLM Agent）如何启动、编排、操作 **Cyberpunk WebTerm** 服务，并配合移动端 Web 浏览器实现人机协作、长任务持久化执行以及跨设备状态保留与工作交接。

---

## 核心价值与应用场景

```
+-------------------------------------------------------------------------+
|                         Cyberpunk WebTerm Server                         |
|  +-------------------+   +--------------------+   +-------------------+ |
|  |  Node-PTY Daemon  | < |  RingBuffer (2000) | > | WebSocket Gateway | |
|  +-------------------+   +--------------------+   +-------------------+ |
+-----------------------------^-------------------------------^-----------+
                              |                               |
                   [长任务持久化 / 无断联丢失]              [多端同步 / 会话保持]
                              |                               |
           +------------------+---------------+               |
           |                                  |               |
     +-----+------+                    +------+-----+   +-----+------+
     |  AI Agent  |                    | 手机移动端  |   | 桌面浏览器  |
     | (自动化操作) |                    | (随时随地接管)|   | (大屏协作)  |
     +------------+                    +------------+   +------------+
```

1. **长任务持久化执行（Background Persistence）**：
   - AI Agent 需要执行耗时任务（代码构建、模型微调、大数据迁移、系统巡检）。
   - 普通子进程会随着上下文或连接中断而终止；WebTerm 将 PTY 进程托管在服务端后台，即使网络闪断、Agent 轮次结束，任务依旧在后台安全运行。
2. **跨设备上下文保留（Context Continuation）**：
   - 具有 2000 行环形缓冲区（RingBuffer），重连时瞬间回放现场。
   - 用户可随时从电脑离开，在手机浏览器中打开 URL，免密或带密直接恢复之前的终端现场，保留上下文继续操作。
3. **人机实时协同（Human-Agent Co-Terminal）**：
   - Agent 与人类用户可以同时挂载同一个 Session：Agent 在终端输入命令或监控输出，用户可以在移动端看到实时跳动的字符，甚至可以直接键入纠错或补充指令。
4. **移动端专属输入体验**：
   - 针对触屏优化的横屏分体双键盘（左右拇指操作）、竖屏辅助快捷键栏（Ctrl、Alt、Tab、Esc、光标键、管道符等）。
   - 支持中文语音转文字（ASR），在手机上可直接用语音下发 Shell 命令。
5. **全功能目录树与前 300 字节二进制可视化（Dual-Pane File Explorer）**：
   - 顶部状态栏一键在 `[ 📟 终端 ]` 与 `[ 📁 文件 ]` 之间无损平滑切换（终端后台持续运行，切回不丢状态）。
   - 集成高频文件操作：新建文件/文件夹、重命名、删除、上传、下载、复制路径、一键“终端打开”（`cd` 进入目录）。
   - **选到文件双栏深度预览**：
     - **左侧**：代码文本（带行号高亮与直接编辑保存）、Markdown 渲染/源码切换、图片、音视频播放、PDF。
     - **右侧**：**右上 300 字节标准 Hex Dump**（Offset/Hex/ASCII 着色）+ **右下 16×N 字节热力阵列与特征谱分析**（Null/ASCII/控制符/高位字节区间映射、魔数识别与信息熵）。

---

## 快速启动服务

### 1. 启动命令

WebTerm 已预编译为单文件 JS（`webterm.cjs`），内置多架构原生库（Linux x86_64/arm64、macOS Apple Silicon/Intel），开箱即用。

#### 常用启动方式：
```bash
# 方式 A: 指定端口与固定密码（推荐 Agent 编排使用，便于告知用户）
node webterm.cjs --port 13399 -P "mysecurepass"

# 方式 B: 使用预计算哈希（生产自动化，避免进程列表暴露明文）
node webterm.cjs --port 13399 --hash ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f

# 方式 C: 一键下载并启动脚本 (新机器首次部署)
curl -fsSL https://raw.githubusercontent.com/xxmyshf/webtram/master/install.sh | bash -s -- --port 13399 -P "mysecurepass"
```

#### 关键命令行参数：
| 参数 | 缩写 | 描述 | 示例 |
| :--- | :--- | :--- | :--- |
| `--port <端口>` | `-p` | 服务监听端口（默认 13399 或 `PORT` 环境变量） | `--port 8080` |
| `--password <密码>`| `-P` | 初始/覆盖访问密码（自动生成 SHA-256 并持久化） | `-P 12345678` |
| `--hash <哈希>` | | 预计算的 SHA-256 密码哈希值 | `--hash 64位十六进制` |
| `--update` | `-u` | （install.sh 专有）强制更新单文件至最新版 | `./install.sh --update` |
| `--help` | `-h` | 查看命令行参数帮助 | `node webterm.cjs --help` |

#### 环境变量配置 (`.env` 或直接传递)：
- `PORT`：服务端口
- `ENABLE_HTTPS`：是否启用自签名 HTTPS（默认 `true`，麦克风语音输入强依赖 HTTPS）
- `TERMINAL_PASSWORD_HASH`：64 位 SHA-256 密码散列
- `DEFAULT_SHELL`：默认 Shell（如 `/bin/bash`、`/bin/zsh`、`/bin/sh`）
- `SESSION_TIMEOUT_MINUTES`：客户端全部断开后的会话保活超时时长（默认 30 分钟）
- `MAX_HISTORY_LINES`：历史回放行数（默认 2000 行）

---

## Agent 与 WebTerm 交互协议 (WebSocket)

WebTerm 暴露标准 WebSocket 接口 `wss://<host>:<port>/ws`。Agent 可通过 Node.js (`ws`)、Python (`websockets`/`websocket-client`) 建立连接并操控。

### 1. 鉴权与建立会话 (`auth`)
连接成功后，首条消息必须发送 `auth`。`password` 为密码的 SHA-256 哈希值：
```json
{
  "type": "auth",
  "password": "<SHA-256 哈希值>",
  "sessionId": "可选已存在的SessionID以恢复现场",
  "cols": 120,
  "rows": 40
}
```

服务端响应成功：
```json
{
  "type": "auth_ok",
  "sessionId": "term-mu6zw18t-j5vak"
}
```
此时服务端会自动将该 Session 历史积累的 RingBuffer 完整推送到客户端。

### 2. 向终端发送输入 (`input`)
```json
{
  "type": "input",
  "data": "ls -la\n"
}
```

### 3. 接收终端输出 (`output`)
```json
{
  "type": "output",
  "data": "total 48\ndrwxr-xr-x ..."
}
```

### 4. 调整窗口尺寸 (`resize`)
```json
{
  "type": "resize",
  "cols": 160,
  "rows": 48
}
```

### 5. 心跳保活 (`ping` / `pong`)
```json
{ "type": "ping" } -> { "type": "pong" }
```

---

## 手机移动端接入与无缝接管指南

当 Agent 启动了任务或部署好 WebTerm 后，可通过以下步骤向用户提供便捷的移动端接管链接：

### 1. 生成移动端一键直达链接

为了让用户在手机上免去复杂的密码输入，可以在 URL 中使用 `pwd` 参数直接带入明文密码（前端自动计算 SHA-256 并持久化到客户端 localStorage）：

```
https://<局域网或公网IP>:<PORT>/?pwd=<明文密码>
```

#### 可选增强参数：
- `pwd=<密码>`：自动填充并自动登入，避免在手机屏幕上反复输入长密码。
- `cmd=<启动命令>`：登入后自动键入执行指定 Shell 指令（如 `htop`、`tail -f /var/log/app.log` 等）。
- 示例：`https://192.168.3.112:13399/?pwd=mysecurepass&cmd=htop`

### 2. 告知用户移动端交互技巧
在交付给用户时，提醒用户以下最佳操作体验：
1. **SSL 自签名证书信任**：
   - 首次访问提示“证书不受信任”时，点击“高级” -> “继续前往”。HTTPS 是移动端浏览器启用 Web Speech API（语音识别）的必要前提。
2. **手机横屏操作（强烈推荐）**：
   - 将手机屏幕横置，WebTerm 会自动展开为**赛博朋克分体式左右虚拟全键盘**。
   - 左手大拇指掌控常用控制键（Ctrl、Alt、Tab、Esc、Shift）、右手掌控回车、光标与符号，实现媲美实体键盘的高速命令敲击。
3. **中文语音输入**：
   - 点击虚拟键盘上的麦克风按钮，直接说话即可高精度转为命令文本，特别适合输入复杂的路径或中文文本。
4. **锁屏与切应用不中断**：
   - 手机切到微信或锁屏后，服务端终端进程保持常驻；重新点开网页即可从 RingBuffer 秒级恢复终端画面。

---

## Agent 标准操作工作流示例

### 场景：Agent 启动持久监控任务并交接给手机端

1. **检查并后台启动 WebTerm**：
   ```bash
   # 后台启动并指定安全密码
   node webterm.cjs --port 13399 -P "wanlian123" > webterm.log 2>&1 &
   ```
2. **确认服务已就绪**：
   检查日志是否输出 `Server initialized on /ws` 与运行 URL。
3. **在会话中执行关键长任务**：
   通过 WebSocket 或直接在后台运行长效任务（如训练、编译）。
4. **生成交接卡片提供给用户**：
   向用户输出结构化卡片：
   > 🚀 **持久终端已启动就绪**
   > - **访问地址**：[https://192.168.3.112:13399/?pwd=wanlian123](https://192.168.3.112:13399/?pwd=wanlian123)
   > - **访问密码**：`wanlian123`
   > - **当前状态**：长任务正在后台执行中，随时支持手机横屏查看或通过语音交互。

---

## 异常自愈与诊断

1. **端口被占用 (`EADDRINUSE`)**：
   - 检查占用端口：`lsof -i :<port>` 或 `netstat -tlpn | grep <port>`
   - 杀掉残留实例：`pkill -f "node.*webterm"`
2. **原生 PTY 架构不匹配**：
   - WebTerm 内置自动自愈特性，启动时若发现磁盘残留的 `build/Release/pty.node` 与当前系统（x86_64 或 aarch64）不匹配，会自动重新释放适配架构的动态库。
3. **会话超时自动清理**：
   - 当所有客户端（Agent 和移动端）断开达到 `SESSION_TIMEOUT_MINUTES`（默认30分钟）后，服务端会自动释放 PTY 资源以避免僵尸进程。
