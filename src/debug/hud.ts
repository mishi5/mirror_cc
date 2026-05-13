/**
 * 簡易 HUD。指数移動平均で FPS と detect time をなめらかに表示する。
 * value = value + (sample - value) * SMOOTHING で更新。
 */
const SMOOTHING = 0.1;

export class Hud {
  private fpsEl: HTMLElement;
  private detectEl: HTMLElement;
  private root: HTMLElement;
  private lastFrameTime: number | null = null;
  private smoothedFps = 0;
  private smoothedDetectMs = 0;

  constructor(root: HTMLElement, fpsEl: HTMLElement, detectEl: HTMLElement) {
    this.root = root;
    this.fpsEl = fpsEl;
    this.detectEl = detectEl;
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  /**
   * 毎フレーム呼ぶ。now は performance.now()、detectMs は pose detect の実時間 (ms)。
   * pose が検出できなかったフレームでも呼んで FPS を更新できる (detectMs は前値継続でよい)。
   */
  update(now: number, detectMs: number): void {
    if (this.lastFrameTime !== null) {
      const dt = now - this.lastFrameTime;
      const instantFps = dt > 0 ? 1000 / dt : 0;
      this.smoothedFps += (instantFps - this.smoothedFps) * SMOOTHING;
    }
    this.lastFrameTime = now;
    this.smoothedDetectMs += (detectMs - this.smoothedDetectMs) * SMOOTHING;

    this.fpsEl.textContent = `FPS: ${this.smoothedFps.toFixed(0)}`;
    this.detectEl.textContent = `detect: ${this.smoothedDetectMs.toFixed(1)} ms`;
  }
}
