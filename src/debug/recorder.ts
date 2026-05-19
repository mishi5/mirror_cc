/**
 * デバッグ用のフレーム記録機。過渡的なアタック動作は HUD で読めないため、
 * 毎フレームの判定状態と候補シグナル (肩↔手首距離) をメモリに溜め、
 * キー操作で JSON ファイルとしてダウンロードする。チューニングの実測に使う。
 *
 * メモリは上限付きリングバッファ (既定 ~60s 相当) で無制限肥大を防ぐ。
 */
export interface RecorderSample {
  /** performance.now() (ms) */
  readonly t: number;
  readonly action: string;
  readonly cScore: number;
  readonly gScore: number;
  readonly aScore: number;
  readonly cActive: boolean;
  readonly gActive: boolean;
  readonly aActive: boolean;
  /** attack ディテクタの detail 文字列 (spd/dst/pk) */
  readonly attackDetail: string;
  /** 肩↔手首の 3D 距離 (腕の伸展量, m)。新しいアタック信号の候補。取得不可なら null */
  readonly extLeft: number | null;
  readonly extRight: number | null;
  /** 主要関節の worldLandmarks visibility */
  readonly visNose: number;
  readonly visLs: number;
  readonly visRs: number;
  readonly visLw: number;
  readonly visRw: number;
}

export class DebugRecorder {
  private readonly buf: RecorderSample[] = [];
  private readonly maxSamples: number;
  private attackFrames = 0;

  constructor(maxSamples = 4000) {
    this.maxSamples = maxSamples;
  }

  record(sample: RecorderSample): void {
    if (sample.aActive) {
      this.attackFrames += 1;
    }
    this.buf.push(sample);
    if (this.buf.length > this.maxSamples) {
      this.buf.shift();
    }
  }

  stats(): { frames: number; attackFrames: number } {
    return { frames: this.buf.length, attackFrames: this.attackFrames };
  }

  /** 記録を JSON 文字列にして返す (テスト可能な純粋部分)。 */
  serialize(): string {
    return JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        attackFrames: this.attackFrames,
        frameCount: this.buf.length,
        frames: this.buf,
      },
      null,
      2,
    );
  }

  /** ブラウザでファイルダウンロードを起動する (DOM 依存・テスト対象外)。 */
  download(): void {
    const blob = new Blob([this.serialize()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mirror-cc-debug-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
