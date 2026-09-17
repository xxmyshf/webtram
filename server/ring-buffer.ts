export class RingBuffer {
  private chunks: string[] = [];
  private totalLines = 0;
  private readonly maxLines: number;

  constructor(maxLines: number = 2000) {
    this.maxLines = maxLines;
  }

  public write(data: string): void {
    if (!data) return;

    this.chunks.push(data);
    const newLines = (data.match(/\n/g) || []).length;
    this.totalLines += newLines;

    // Prune old chunks if exceeding maxLines
    while (this.totalLines > this.maxLines && this.chunks.length > 1) {
      const removed = this.chunks.shift();
      if (removed) {
        const removedLines = (removed.match(/\n/g) || []).length;
        this.totalLines -= removedLines;
      }
    }
  }

  public getReplayData(): string {
    return this.chunks.join('');
  }

  public clear(): void {
    this.chunks = [];
    this.totalLines = 0;
  }

  public getLineCount(): number {
    return this.totalLines;
  }
}
