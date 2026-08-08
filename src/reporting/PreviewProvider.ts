/** Small versioned cache prevents a late preview response replacing a newer
 * reporting-month selection. The Electron IPC remains the sole renderer. */
export class PreviewProvider {
  private version = 0;
  async prepare(month: string, load: (month: string) => Promise<string>): Promise<string | null> {
    const requestVersion = ++this.version;
    const html = await load(month);
    return requestVersion === this.version ? html : null;
  }
  invalidate(): void { this.version++; }
}
