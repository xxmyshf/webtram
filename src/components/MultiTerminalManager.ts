import { TerminalManager } from './TerminalManager.js';

export interface MultiTerminalManagerOptions {
  container: HTMLElement;
  onInput: (sessionId: string, data: string) => void;
  onResize: (sessionId: string, cols: number, rows: number) => void;
  onUnread?: (sessionId: string) => void;
}

interface TerminalEntry {
  id: string;
  term: TerminalManager;
  subContainer: HTMLElement;
}

export class MultiTerminalManager {
  private container: HTMLElement;
  private options: MultiTerminalManagerOptions;
  private terminals = new Map<string, TerminalEntry>();
  private activeSessionId: string | null = null;

  constructor(options: MultiTerminalManagerOptions) {
    this.container = options.container;
    this.options = options;
  }

  public getOrCreateTerminal(sessionId: string): TerminalManager {
    const existing = this.terminals.get(sessionId);
    if (existing) {
      return existing.term;
    }

    const subContainer = document.createElement('div');
    subContainer.className = 'terminal-instance';
    subContainer.setAttribute('data-session-id', sessionId);
    subContainer.style.width = '100%';
    subContainer.style.height = '100%';
    subContainer.style.position = 'relative';

    // If not first and not active, start hidden
    const shouldBeActive = this.terminals.size === 0 || this.activeSessionId === sessionId;
    subContainer.style.display = shouldBeActive ? 'block' : 'none';

    this.container.appendChild(subContainer);

    const term = new TerminalManager({
      container: subContainer,
      onInput: (data) => {
        this.options.onInput(sessionId, data);
      },
      onResize: (cols, rows) => {
        this.options.onResize(sessionId, cols, rows);
      }
    });

    this.terminals.set(sessionId, {
      id: sessionId,
      term,
      subContainer
    });

    if (shouldBeActive) {
      this.activeSessionId = sessionId;
      requestAnimationFrame(() => {
        term.fit();
      });
    }

    return term;
  }

  public hasTerminal(sessionId: string): boolean {
    return this.terminals.has(sessionId);
  }

  public getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  public getActiveTerminal(): TerminalManager | null {
    if (!this.activeSessionId) return null;
    return this.terminals.get(this.activeSessionId)?.term || null;
  }

  public switchSession(sessionId: string): boolean {
    if (!this.terminals.has(sessionId)) {
      return false;
    }

    if (this.activeSessionId === sessionId) {
      this.getActiveTerminal()?.focus();
      return true;
    }

    // Hide old
    if (this.activeSessionId) {
      const oldEntry = this.terminals.get(this.activeSessionId);
      if (oldEntry) {
        oldEntry.subContainer.style.display = 'none';
      }
    }

    // Show new
    this.activeSessionId = sessionId;
    const newEntry = this.terminals.get(sessionId)!;
    newEntry.subContainer.style.display = 'block';

    requestAnimationFrame(() => {
      newEntry.term.fit();
      const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
      if (!isTouch) {
        newEntry.term.focus();
      }
    });

    return true;
  }

  public write(sessionId: string, data: string): void {
    const entry = this.terminals.get(sessionId);
    if (entry) {
      entry.term.write(data);
      if (this.activeSessionId !== sessionId) {
        this.options.onUnread?.(sessionId);
      }
    }
  }

  public clear(sessionId?: string): void {
    const targetId = sessionId || this.activeSessionId;
    if (targetId) {
      const entry = this.terminals.get(targetId);
      entry?.term.clear();
    }
  }

  public removeTerminal(sessionId: string): void {
    const entry = this.terminals.get(sessionId);
    if (!entry) return;

    entry.term.dispose();
    if (entry.subContainer.parentNode) {
      entry.subContainer.parentNode.removeChild(entry.subContainer);
    }
    this.terminals.delete(sessionId);

    // If active session was removed, switch to another
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
      const remainingIds = Array.from(this.terminals.keys());
      if (remainingIds.length > 0) {
        this.switchSession(remainingIds[remainingIds.length - 1]);
      }
    }
  }

  public fit(): void {
    const active = this.getActiveTerminal();
    active?.fit();
  }

  public focus(): void {
    const active = this.getActiveTerminal();
    active?.focus();
  }

  public getCols(): number {
    return this.getActiveTerminal()?.getCols() || 80;
  }

  public getRows(): number {
    return this.getActiveTerminal()?.getRows() || 24;
  }

  public getFontSize(): number {
    const active = this.getActiveTerminal();
    return active ? active.getFontSize() : 14;
  }

  public setFontSize(size: number): number {
    let result = size;
    for (const entry of this.terminals.values()) {
      result = entry.term.setFontSize(size);
    }
    return result;
  }

  public scrollByDeltaY(deltaY: number): void {
    const active = this.getActiveTerminal();
    active?.scrollByDeltaY(deltaY);
  }

  public dispose(): void {
    for (const entry of this.terminals.values()) {
      entry.term.dispose();
    }
    this.terminals.clear();
    this.activeSessionId = null;
  }
}
