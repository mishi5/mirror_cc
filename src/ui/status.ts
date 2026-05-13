import type { AppStatus } from "../pose/types";

/**
 * #status 要素の見た目と動作を制御する。
 * - `data-state="loading"` / `"error"` / `"ok"` で CSS 表示切替
 * - error 時は retry ボタンを表示しコールバックを発火
 *
 * DOM 構成 (index.html 側で固定):
 *   <div id="status" data-state="loading">
 *     <p id="status-message">...</p>
 *     <button id="status-retry" hidden>...</button>
 *   </div>
 */
export class StatusUi {
  private root: HTMLElement;
  private message: HTMLElement;
  private retry: HTMLButtonElement;
  private onRetry: (() => void) | null = null;

  constructor(
    root: HTMLElement,
    message: HTMLElement,
    retry: HTMLButtonElement,
  ) {
    this.root = root;
    this.message = message;
    this.retry = retry;
    this.retry.addEventListener("click", () => {
      this.onRetry?.();
    });
  }

  setStatus(status: AppStatus, onRetry?: () => void): void {
    this.root.dataset.state = status.kind;
    this.onRetry = onRetry ?? null;

    if (status.kind === "ok") {
      this.message.textContent = "";
      this.retry.hidden = true;
      this.retry.textContent = "";
      return;
    }

    this.message.textContent = status.message;

    if (status.kind === "error" && onRetry) {
      this.retry.hidden = false;
      this.retry.textContent = status.retryLabel ?? "再試行";
    } else {
      this.retry.hidden = true;
    }
  }
}
