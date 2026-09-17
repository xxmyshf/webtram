import { AudioRecorder } from './AudioRecorder.js';

export type ASREngineType = 'browser' | 'mega-asr' | 'custom';

export interface ASRSettings {
  engine: ASREngineType;
  lang: string;
  megaAsrUrl: string;
  customUrl: string;
  customKey: string;
}

const DEFAULT_SETTINGS: ASRSettings = {
  engine: 'browser',
  lang: 'zh-CN',
  megaAsrUrl: '/api/asr/mega-asr',
  customUrl: '',
  customKey: ''
};

export class SpeechManager {
  private settings: ASRSettings;
  private audioRecorder: AudioRecorder;
  private speechRecognition: any = null;
  private browserTranscribedText = '';
  private isBrowserRecognizing = false;

  constructor() {
    this.settings = this.loadSettings();
    this.audioRecorder = new AudioRecorder();
    this.initBrowserRecognition();
  }

  public getSettings(): ASRSettings {
    return { ...this.settings };
  }

  public saveSettings(newSettings: Partial<ASRSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    localStorage.setItem('webterm_asr_config', JSON.stringify(this.settings));
    this.initBrowserRecognition();
  }

  private loadSettings(): ASRSettings {
    try {
      const saved = localStorage.getItem('webterm_asr_config');
      if (saved) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      }
    } catch {}
    return { ...DEFAULT_SETTINGS };
  }

  private initBrowserRecognition(): void {
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognitionClass) {
      try {
        this.speechRecognition = new SpeechRecognitionClass();
        this.speechRecognition.continuous = false;
        this.speechRecognition.interimResults = true;
        this.speechRecognition.lang = this.settings.lang || 'zh-CN';

        this.speechRecognition.onresult = (event: any) => {
          let text = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            text += event.results[i][0].transcript;
          }
          this.browserTranscribedText = text;
        };

        this.speechRecognition.onerror = (e: any) => {
          console.warn('[SpeechManager] Browser recognition error:', e.error);
        };
      } catch (err) {
        console.warn('[SpeechManager] Browser speech recognition not supported:', err);
        this.speechRecognition = null;
      }
    } else {
      this.speechRecognition = null;
    }
  }

  public async start(): Promise<AudioRecorder> {
    this.browserTranscribedText = '';

    // Always start AudioRecorder for real-time waveform visualization
    await this.audioRecorder.start();

    // If browser native is enabled and supported, also start SpeechRecognition
    if (this.settings.engine === 'browser' && this.speechRecognition) {
      try {
        this.isBrowserRecognizing = true;
        this.speechRecognition.start();
      } catch (err) {
        console.warn('[SpeechManager] Could not start browser speech recognition, will fallback to audio API:', err);
        this.isBrowserRecognizing = false;
      }
    }

    return this.audioRecorder;
  }

  public async stop(): Promise<string> {
    // Stop browser recognition if active
    if (this.isBrowserRecognizing && this.speechRecognition) {
      try {
        this.speechRecognition.stop();
      } catch {}
      this.isBrowserRecognizing = false;
    }

    // Stop audio recorder to get WAV
    const wavBlob = await this.audioRecorder.stop();

    // 1. If browser recognition produced text, return it immediately (zero latency!)
    if (this.settings.engine === 'browser' && this.browserTranscribedText.trim().length > 0) {
      return this.browserTranscribedText.trim();
    }

    // 2. If engine is Mega-ASR (or browser recognition returned empty, fallback to Mega-ASR)
    if (this.settings.engine === 'mega-asr' || (this.settings.engine === 'browser' && wavBlob)) {
      if (!wavBlob) return '';
      try {
        const url = this.settings.megaAsrUrl || '/api/asr/mega-asr';
        const formData = new FormData();
        formData.append('file', wavBlob, 'audio.wav');

        const resp = await fetch(url, {
          method: 'POST',
          body: formData
        });

        if (resp.ok) {
          const data = await resp.json();
          if (data.success && data.text) {
            return data.text;
          } else if (typeof data.text === 'string') {
            return data.text;
          } else if (Array.isArray(data.text)) {
            return data.text.join(' ');
          }
        }
      } catch (err) {
        console.error('[SpeechManager] Mega-ASR request failed:', err);
      }
    }

    // 3. Custom endpoint
    if (this.settings.engine === 'custom' && this.settings.customUrl && wavBlob) {
      try {
        const formData = new FormData();
        formData.append('file', wavBlob, 'audio.wav');
        const headers: Record<string, string> = {};
        if (this.settings.customKey) {
          headers['Authorization'] = `Bearer ${this.settings.customKey}`;
        }

        const resp = await fetch(this.settings.customUrl, {
          method: 'POST',
          headers,
          body: formData
        });

        if (resp.ok) {
          const data = await resp.json();
          if (typeof data.text === 'string') return data.text;
          if (data.success && data.text) return data.text;
        }
      } catch (err) {
        console.error('[SpeechManager] Custom ASR request failed:', err);
      }
    }

    // Default fallback to local ASR endpoint
    if (wavBlob) {
      try {
        const formData = new FormData();
        formData.append('audio', wavBlob, 'audio.wav');
        const resp = await fetch('/api/asr', { method: 'POST', body: formData });
        if (resp.ok) {
          const data = await resp.json();
          if (data.text) return data.text;
        }
      } catch {}
    }

    return this.browserTranscribedText.trim();
  }

  public cancel(): void {
    if (this.isBrowserRecognizing && this.speechRecognition) {
      try {
        this.speechRecognition.abort();
      } catch {}
      this.isBrowserRecognizing = false;
    }
    this.audioRecorder.cancel();
  }

  public getRecorder(): AudioRecorder {
    return this.audioRecorder;
  }
}
