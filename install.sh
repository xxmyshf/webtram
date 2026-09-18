#!/usr/bin/env bash
# ==============================================================================
# ⚡ Cyberpunk WebTerm // 一键安装与极速启动脚本
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/xxmyshf/webtram/master/install.sh | bash
#   或本地执行: ./install.sh [--port <端口>]
# ==============================================================================

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color
BOLD='\033[1m'

echo -e "${CYAN}"
cat << "BANNER"
 __      __      ___.   ___________                       
/  \    /  \ ____\_ |__ \__    ___/__________  _____      
\   \/\/   // __ \| __ \  |    |_/ __ \_  __ \/     \     
 \        /\  ___/| \_\ \ |    |\  ___/|  | \/  Y Y  \    
  \__/\  /  \___  >___  / |____| \___  >__|  |__|_|  /    
       \/       \/    \/             \/            \/     
      ⚡ CYBERPUNK WEB TERMINAL // ALL-IN-ONE ⚡
BANNER
echo -e "${NC}"

echo -e "${BOLD}[1/3] 检查系统运行环境...${NC}"
if ! command -v node >/dev/null 2>&1; then
    echo -e "${RED}❌ 错误: 未检测到 Node.js 运行环境！${NC}"
    echo -e "${YELLOW}请先安装 Node.js (推荐 v18 或以上版本)：${NC}"
    echo -e "   Ubuntu/Debian: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
    echo -e "   CentOS/RHEL:   curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - && sudo yum install -y nodejs"
    echo -e "   macOS (Brew):  brew install node"
    exit 1
fi

NODE_VER=$(node -v)
echo -e "${GREEN}✅ 已检测到 Node.js: ${NODE_VER}${NC}"

TARGET_DIR="${WEBTERM_DIR:-.}"
mkdir -p "$TARGET_DIR"
cd "$TARGET_DIR"

BUNDLE_FILE="webterm.cjs"
REPO_RAW_URL="https://raw.githubusercontent.com/xxmyshf/webtram/master/webterm.cjs"

echo -e "\n${BOLD}[2/3] 准备一体化单文件服务程序...${NC}"
if [ -f "$BUNDLE_FILE" ]; then
    echo -e "${GREEN}✅ 检测到本地已存在 ${BUNDLE_FILE}，直接启动！${NC}"
else
    echo -e "${CYAN}⬇️ 正在从 GitHub 下载最新版一体化单文件 ${BUNDLE_FILE} ...${NC}"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$REPO_RAW_URL" -o "$BUNDLE_FILE"
    elif command -v wget >/dev/null 2>&1; then
        wget -q "$REPO_RAW_URL" -O "$BUNDLE_FILE"
    else
        echo -e "${RED}❌ 错误: 缺少 curl 或 wget 工具，无法自动下载。${NC}"
        exit 1
    fi
    chmod +x "$BUNDLE_FILE"
    echo -e "${GREEN}✅ 下载完成: $(pwd)/${BUNDLE_FILE}${NC}"
fi

echo -e "\n${BOLD}[3/3] 启动 Cyberpunk WebTerm 终端服务...${NC}"
echo -e "${GREEN}💡 运行提示:${NC}"
echo -e "   - 默认端口: ${CYAN}13399${NC} (可通过 --port 参数或环境变量 PORT 修改)"
echo -e "   - 默认访问密码: ${CYAN}12345678${NC} (可通过 -P/--password 或 --hash 指定，或在界面右上角锁形图标弹窗随时修改)
   - 命令行参数支持: ${CYAN}--port <端口> -P <密码> --hash <哈希> --help${NC}"
echo -e "   - 首次启动会自动在当前目录生成 ${CYAN}.env${NC}、${CYAN}certs/${NC} 与 ${CYAN}dist/${NC} 目录"
echo -e "=================================================="

# 启动服务并透传所有命令行参数 (如 --port 8080)
exec node "$BUNDLE_FILE" "$@"
