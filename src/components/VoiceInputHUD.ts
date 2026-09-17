import { AudioRecorder } from './AudioRecorder.js';

export type VoiceHUDState = 'listening' | 'cancel' | 'processing';

export class VoiceInputHUD {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private statusTextEl: HTMLElement;
  private subTextEl: HTMLElement;
  private animFrameId: number | null = null;
  private audioRecorder: AudioRecorder | null = null;
  private currentState: VoiceHUDState = 'listening';

  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'cyber-voice-hud';
    this.container.innerHTML = `
      <div class="hud-glass-card">
        <div class="hud-icon-wrapper">
          <svg class="hud-mic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        </div>
        <canvas class="hud-waveform-canvas" width="220" height="60"></canvas>
        <div class="hud-status-text">正在聆听...</div>
        <div class="hud-sub-text">↑ 上滑超过 50px 取消</div>
      </div>
    `;

    this.canvas = this.container.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.statusTextEl = this.container.querySelector('.hud-status-text')!;
    this.subTextEl = this.container.querySelector('.hud-sub-text')!;
    this.hide();
    document.body.appendChild(this.container);
  }

  public show(recorder: AudioRecorder): void {
    this.audioRecorder = recorder;
    this.setState('listening');
    this.container.classList.add('visible');
    this.startWaveformAnimation();
  }

  public hide(): void {
    this.container.classList.remove('visible');
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  public setState(state: VoiceHUDState): void {
    if (this.currentState === state) return;
    this.currentState = state;

    this.container.classList.remove('state-listening', 'state-cancel', 'state-processing');
    this.container.classList.add(`state-${state}`);

    if (state === 'listening') {
      this.statusTextEl.textContent = '正在聆听...';
      this.subTextEl.textContent = '↑ 上滑超过 50px 取消';
    } else if (state === 'cancel') {
      this.statusTextEl.textContent = '松开取消发送';
      this.subTextEl.textContent = '滑回下方可继续录音';
    } else if (state === 'processing') {
      this.statusTextEl.textContent = '正在识别语音...';
      this.subTextEl.textContent = '请稍候';
    }
  }

  private startWaveformAnimation(): void {
    const dataArray = new Uint8Array(64);

    const render = () => {
      this.animFrameId = requestAnimationFrame(render);
      const width = this.canvas.width;
      const height = this.canvas.height;
      this.ctx.clearRect(0, 0, width, height);

      if (this.audioRecorder && this.currentState !== 'processing') {
        this.audioRecorder.getFrequencyData(dataArray);
      } else {
        // Simulated idle pulse
        for (let i = 0; i < dataArray.length; i++) {
          dataArray[i] = Math.sin(Date.now() / 200 + i * 0.3) * 15 + 20;
        }
      }

      const barCount = 28;
      const barWidth = 4;
      const gap = 3;
      const startX = (width - (barCount * (barWidth + gap) - gap)) / 2;
      const isCancel = this.currentState === 'cancel';

      for (let i = 0; i < barCount; i++) {
        const val = dataArray[i % dataArray.length] || 10;
        const normalized = Math.min(1, Math.max(0.1, val / 180));
        const barHeight = Math.max(6, normalized * height * 0.85);

        const x = startX + i * (barWidth + gap);
        const y = (height - barHeight) / 2;

        this.ctx.fillStyle = isCancel
          ? 'rgba(255, 56, 96, 0.9)'
          : 'rgba(0, 229, 255, 0.9)';
        this.ctx.shadowColor = isCancel ? '#ff3860' : '#00e5ff';
        this.ctx.shadowBlur = isCancel ? 8 : 10;

        // Draw rounded capsule bar
        this.drawRoundedRect(this.ctx, x, y, barWidth, barHeight, 2);
      }
    };

    render();
  }

  private drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
  }
}
