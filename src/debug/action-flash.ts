/**
 * アタックは過渡的で 1 フレームしか出ないため人間には判別不能。
 * 発火の立ち上がりで大きなバナーを一定時間ラッチ表示し、さらに
 * 「直近アタックから何秒前 / 累計回数」を常時表示して見逃しても分かるようにする。
 */

/** ラッチ表示の残り時間 (ms)。0 以下なら非表示。純粋関数 (テスト対象)。 */
export function flashRemainingMs(
  lastAtMs: number | null,
  now: number,
  durationMs: number,
): number {
  if (lastAtMs === null) return 0;
  const rem = durationMs - (now - lastAtMs);
  return rem > 0 ? rem : 0;
}

const FLASH_MS = 1000;

export class ActionFlash {
  private banner: HTMLElement;
  private lastLine: HTMLElement;
  private lastAttackMs: number | null = null;
  private attackCount = 0;

  constructor(banner: HTMLElement, lastLine: HTMLElement) {
    this.banner = banner;
    this.lastLine = lastLine;
  }

  /** アタック立ち上がりで呼ぶ (action-detector の attack.active が false→true)。 */
  notifyAttack(now: number): void {
    this.lastAttackMs = now;
    this.attackCount += 1;
  }

  /** 毎フレーム呼ぶ。ラッチ表示と直近表示を更新する。 */
  render(now: number): void {
    const rem = flashRemainingMs(this.lastAttackMs, now, FLASH_MS);
    if (rem > 0) {
      this.banner.hidden = false;
      // 残り時間で不透明度をフェード (1→0)
      this.banner.style.opacity = String(Math.min(1, rem / FLASH_MS + 0.2));
    } else {
      this.banner.hidden = true;
    }

    if (this.lastAttackMs === null) {
      this.lastLine.textContent = "LAST ATTACK: none";
    } else {
      const ago = ((now - this.lastAttackMs) / 1000).toFixed(1);
      this.lastLine.textContent = `LAST ATTACK: ${ago}s ago  x${this.attackCount}`;
    }
  }

  clear(): void {
    this.lastAttackMs = null;
    this.attackCount = 0;
    this.banner.hidden = true;
    this.lastLine.textContent = "LAST ATTACK: none";
  }
}
