import { FileReadResult } from './types.js';

export class BinaryInspectorPane {
  private container: HTMLElement;
  private currentData: FileReadResult | null = null;
  private selectedByteIndex: number | null = null;

  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'binary-inspector-pane';
    this.renderEmpty();
  }

  public getElement(): HTMLElement {
    return this.container;
  }

  public render(data: FileReadResult | null): void {
    this.currentData = data;
    this.selectedByteIndex = null;

    if (!data || !data.headBytesHex || data.headBytesHex.length === 0) {
      this.renderEmpty();
      return;
    }

    this.container.innerHTML = `
      <!-- Upper Panel: 300 Bytes Hex Dump -->
      <div class="binary-section binary-hex-section">
        <div class="binary-section-header">
          <div class="section-title-wrap">
            <svg class="cyber-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="3" width="20" height="14" rx="2"></rect>
              <line x1="8" y1="21" x2="16" y2="21"></line>
              <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
            <span class="section-title">HEX DUMP // 前 ${data.headBytesHex.length} 字节二进制渲染</span>
            <span class="cyber-badge badge-cyan">0x0000 - 0x${(data.headBytesHex.length - 1).toString(16).padStart(4, '0')}</span>
          </div>
          <div class="section-actions">
            <button type="button" class="cyber-btn-mini btn-copy-hex" title="复制十六进制数据">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>复制 Hex</span>
            </button>
          </div>
        </div>
        <div class="hex-dump-container">
          <pre class="hex-dump-content">${this.buildHexDump(data.headBytesHex)}</pre>
        </div>
      </div>

      <!-- Lower Panel: Visual Byte Matrix & Spectrum Analysis -->
      <div class="binary-section binary-visual-section">
        <div class="binary-section-header">
          <div class="section-title-wrap">
            <svg class="cyber-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
              <line x1="12" y1="22.08" x2="12" y2="12"></line>
            </svg>
            <span class="section-title">VISUAL MATRIX // 可视化字节渲染与特征分析</span>
          </div>
          <div class="entropy-badge-wrap">
            <span class="cyber-badge badge-magenta" title="Shannon 信息熵 (0~8)">
              熵值: ${data.byteStats.entropy} bits/byte
            </span>
          </div>
        </div>

        <div class="visual-meta-row">
          <div class="meta-card">
            <span class="meta-label">文件特征类型</span>
            <span class="meta-val meta-type" title="${data.byteStats.detectedType}">
              ${data.byteStats.detectedType}
            </span>
          </div>
          <div class="meta-card">
            <span class="meta-label">采样字节数</span>
            <span class="meta-val">${data.byteStats.total} / ${data.size} B</span>
          </div>
        </div>

        <!-- Byte Distribution Spectrum Bar -->
        <div class="byte-spectrum-wrapper">
          <div class="spectrum-legend">
            <span class="legend-item"><span class="dot dot-null"></span> 空字节 (0x00): ${this.calcPercent(data.byteStats.nullCount, data.byteStats.total)}%</span>
            <span class="legend-item"><span class="dot dot-ascii"></span> 可打印 (ASCII): ${this.calcPercent(data.byteStats.asciiPrintableCount, data.byteStats.total)}%</span>
            <span class="legend-item"><span class="dot dot-ctrl"></span> 控制符: ${this.calcPercent(data.byteStats.controlCount, data.byteStats.total)}%</span>
            <span class="legend-item"><span class="dot dot-high"></span> 高位/二进制: ${this.calcPercent(data.byteStats.highByteCount, data.byteStats.total)}%</span>
          </div>
          <div class="spectrum-bar">
            <div class="bar-seg seg-null" style="width: ${this.calcPercent(data.byteStats.nullCount, data.byteStats.total)}%"></div>
            <div class="bar-seg seg-ascii" style="width: ${this.calcPercent(data.byteStats.asciiPrintableCount, data.byteStats.total)}%"></div>
            <div class="bar-seg seg-ctrl" style="width: ${this.calcPercent(data.byteStats.controlCount, data.byteStats.total)}%"></div>
            <div class="bar-seg seg-high" style="width: ${this.calcPercent(data.byteStats.highByteCount, data.byteStats.total)}%"></div>
          </div>
        </div>

        <!-- 16 x N Visual Byte Matrix -->
        <div class="matrix-container">
          <div class="matrix-grid-label">16×N 字节阵列热力图 (悬浮查看详情，点击高亮 Hex):</div>
          <div class="matrix-grid">
            ${this.buildByteMatrix(data.headBytesHex)}
          </div>
          <div class="matrix-detail-bar" id="matrix-detail-bar">
            <span>💡 悬停在方块上查看具体字节偏移、Hex、Dec 与字符</span>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private renderEmpty(): void {
    this.container.innerHTML = `
      <div class="binary-empty-state">
        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="3" width="20" height="14" rx="2"></rect>
          <line x1="8" y1="21" x2="16" y2="21"></line>
          <line x1="12" y1="17" x2="12" y2="21"></line>
        </svg>
        <span class="empty-title">未选择文件</span>
        <span class="empty-desc">在左侧目录树选择文件以实时加载 300 字节二进制 Hex 渲染与可视化特征阵列</span>
      </div>
    `;
  }

  private calcPercent(count: number, total: number): string {
    if (!total || total <= 0) return '0.0';
    return ((count / total) * 100).toFixed(1);
  }

  /**
   * 生成经典的 Hex Dump 文本 (带 HTML span 着色)
   */
  private buildHexDump(hexArr: string[]): string {
    let result = '';
    const bytesPerLine = 16;
    const total = hexArr.length;

    for (let offset = 0; offset < total; offset += bytesPerLine) {
      const lineHex = hexArr.slice(offset, offset + bytesPerLine);
      const offsetHex = offset.toString(16).padStart(8, '0');

      let hexPart1 = '';
      let hexPart2 = '';
      let asciiPart = '';

      for (let i = 0; i < bytesPerLine; i++) {
        if (i < lineHex.length) {
          const byteHex = lineHex[i];
          const byteVal = parseInt(byteHex, 16);
          const byteClass = this.getByteClass(byteVal);
          const byteIdx = offset + i;

          const span = `<span class="hex-byte ${byteClass}" data-byte-idx="${byteIdx}">${byteHex}</span>`;

          if (i < 8) {
            hexPart1 += span + ' ';
          } else {
            hexPart2 += span + ' ';
          }

          // ASCII char representation
          const char = (byteVal >= 32 && byteVal <= 126) ? String.fromCharCode(byteVal) : '.';
          const escapedChar = char === '<' ? '&lt;' : char === '>' ? '&gt;' : char === '&' ? '&amp;' : char;
          asciiPart += `<span class="ascii-char ${byteClass}" data-byte-idx="${byteIdx}">${escapedChar}</span>`;
        } else {
          // padding
          if (i < 8) hexPart1 += '   ';
          else hexPart2 += '   ';
          asciiPart += ' ';
        }
      }

      result += `<span class="hex-offset">${offsetHex}</span>  ${hexPart1} ${hexPart2} |<span class="hex-ascii">${asciiPart}</span>|\n`;
    }

    return result;
  }

  /**
   * 构造 16xN 字节可视化矩阵
   */
  private buildByteMatrix(hexArr: string[]): string {
    return hexArr.map((hex, idx) => {
      const val = parseInt(hex, 16);
      const byteClass = this.getByteClass(val);
      const char = (val >= 32 && val <= 126) ? String.fromCharCode(val) : '.';
      return `<div class="matrix-cell ${byteClass}" data-idx="${idx}" data-hex="${hex}" data-dec="${val}" data-char="${this.escapeHtml(char)}"></div>`;
    }).join('');
  }

  private getByteClass(byteVal: number): string {
    if (byteVal === 0) return 'byte-null';
    if (byteVal >= 32 && byteVal <= 126) return 'byte-ascii';
    if (byteVal < 32) return 'byte-ctrl';
    return 'byte-high';
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private bindEvents(): void {
    const copyBtn = this.container.querySelector<HTMLButtonElement>('.btn-copy-hex');
    if (copyBtn && this.currentData) {
      copyBtn.addEventListener('click', () => {
        const hexStr = this.currentData!.headBytesHex.join(' ');
        navigator.clipboard.writeText(hexStr).then(() => {
          const original = copyBtn.innerHTML;
          copyBtn.innerHTML = `<span>✓ 已复制</span>`;
          setTimeout(() => { copyBtn.innerHTML = original; }, 1500);
        });
      });
    }

    // Matrix hover & click tooltip
    const detailBar = this.container.querySelector<HTMLElement>('#matrix-detail-bar');
    const cells = this.container.querySelectorAll<HTMLElement>('.matrix-cell');

    cells.forEach((cell) => {
      cell.addEventListener('mouseenter', () => {
        const idx = cell.getAttribute('data-idx')!;
        const hex = cell.getAttribute('data-hex')!;
        const dec = cell.getAttribute('data-dec')!;
        const char = cell.getAttribute('data-char')!;
        const offsetHex = parseInt(idx, 10).toString(16).padStart(4, '0');

        if (detailBar) {
          detailBar.innerHTML = `
            <span class="detail-segment"><b>[偏移]</b> +${idx} (0x${offsetHex})</span>
            <span class="detail-segment"><b>[Hex]</b> 0x${hex}</span>
            <span class="detail-segment"><b>[Dec]</b> ${dec}</span>
            <span class="detail-segment"><b>[字符]</b> '${char}'</span>
          `;
        }

        // Highlight corresponding hex byte in dump
        this.highlightByte(parseInt(idx, 10));
      });

      cell.addEventListener('mouseleave', () => {
        if (detailBar && this.selectedByteIndex === null) {
          detailBar.innerHTML = `<span>💡 悬停在方块上查看具体字节偏移、Hex、Dec 与字符</span>`;
        }
        if (this.selectedByteIndex === null) {
          this.clearByteHighlight();
        }
      });

      cell.addEventListener('click', () => {
        const idx = parseInt(cell.getAttribute('data-idx')!, 10);
        this.selectedByteIndex = idx;
        this.highlightByte(idx, true);
      });
    });
  }

  private highlightByte(idx: number, scrollIntoView = false): void {
    this.clearByteHighlight();
    const hexSpan = this.container.querySelector<HTMLElement>(`.hex-byte[data-byte-idx="${idx}"]`);
    const asciiSpan = this.container.querySelector<HTMLElement>(`.ascii-char[data-byte-idx="${idx}"]`);
    const cell = this.container.querySelector<HTMLElement>(`.matrix-cell[data-idx="${idx}"]`);

    if (hexSpan) hexSpan.classList.add('byte-active');
    if (asciiSpan) asciiSpan.classList.add('byte-active');
    if (cell) cell.classList.add('matrix-cell-active');

    if (scrollIntoView && hexSpan) {
      hexSpan.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  private clearByteHighlight(): void {
    this.container.querySelectorAll('.byte-active').forEach((el) => el.classList.remove('byte-active'));
    this.container.querySelectorAll('.matrix-cell-active').forEach((el) => el.classList.remove('matrix-cell-active'));
  }
}
