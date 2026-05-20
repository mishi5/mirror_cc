import type { ActionDetectorResult } from "../pose/detectors/types";

/**
 * 現在の PoseAction と各ディテクタ score / detail をデバッグ表示する。
 * Phase 1 の Hud (FPS/detect) とは別クラスで責務を分離する。
 * detail は各ディテクタの生メトリクス (charge: fwd/bnd/cls/fex,
 * guard: crs/face/fwd/held, attack: spd/dst) で実機チューニングに使う。
 */
export class ActionHud {
  private actionEl: HTMLElement;
  private scoresEl: HTMLElement;
  private detailsEl: HTMLElement;

  constructor(
    actionEl: HTMLElement,
    scoresEl: HTMLElement,
    detailsEl: HTMLElement,
  ) {
    this.actionEl = actionEl;
    this.scoresEl = scoresEl;
    this.detailsEl = detailsEl;
  }

  update(result: ActionDetectorResult): void {
    this.actionEl.textContent = `action: ${result.action}`;
    const c = result.charge.score.toFixed(2);
    const g = result.guard.score.toFixed(2);
    const a = result.attack.score.toFixed(2);
    const mark = (active: boolean): string => (active ? "*" : " ");
    this.scoresEl.textContent =
      `C${mark(result.charge.active)}${c} ` +
      `G${mark(result.guard.active)}${g} ` +
      `A${mark(result.attack.active)}${a}`;
    this.detailsEl.textContent =
      `C:${result.charge.detail ?? "-"} | ` +
      `G:${result.guard.detail ?? "-"} | ` +
      `A:${result.attack.detail ?? "-"}`;
  }

  clear(): void {
    this.actionEl.textContent = "action: —";
    this.scoresEl.textContent = "C — / G — / A —";
    this.detailsEl.textContent = "C — | G — | A —";
  }
}
