import type { Landmark } from "@mediapipe/tasks-vision";
import { KEY_JOINT_INDICES, DEFAULT_VISIBILITY_THRESHOLD } from "../constants";
import type { DetectorParams } from "./params";
import type { DetectorScore } from "./types";
import { jointVec, sub, length } from "./geometry";

export interface AttackDetector {
  /**
   * @param chargeGateOpen charge が直近 active だったか (action-detector が判定して渡す)。
   *   ゲーム的にアタックはチャージ後のみ意味があり、これで idle 動作と判別する。
   */
  update(
    world: ReadonlyArray<Readonly<Landmark>> | null,
    timestampMs: number,
    chargeGateOpen: boolean,
  ): DetectorScore;
}

interface Sample {
  /** 肩↔手首の 3D 距離の最大 (左右どちらか伸びている方, m) */
  readonly ext: number;
  readonly t: number;
}

/**
 * アタック: charge 直後 (chargeGateOpen) の状態から、腕 (肩↔手首距離) が時間窓内で
 * extBurstDelta 以上増え、かつ窓末端の絶対伸展が extHighAbs 以上 (腕が伸び切り近い)
 * になった瞬間に発火する。発火後 refractoryMs は再発火しない。
 *
 * 単眼 MediaPipe の z は前後動をほぼ捉えないため z 速度は使わない。肩↔手首距離は
 * dynamic range が大きく (~0.05-0.53m)、charge 保持 (~0.32) からの伸展バーストは
 * 明確に分離できる。charge gate で idle のランダムな腕動作を除外する。
 *
 * 履歴・lastFireMs はインスタンスに閉じる (将来 Map<poseIndex,...> で2人化)。
 */
export function createAttackDetector(
  params: DetectorParams["attack"],
): AttackDetector {
  const history: Sample[] = [];
  let lastFireMs: number | null = null;
  let peakDelta = 0;
  let peakImprovedMs = 0;

  function armExt(
    world: ReadonlyArray<Readonly<Landmark>>,
    shoulderIdx: number,
    wristIdx: number,
  ): number | null {
    const s = jointVec(world, shoulderIdx, DEFAULT_VISIBILITY_THRESHOLD);
    const w = jointVec(world, wristIdx, DEFAULT_VISIBILITY_THRESHOLD);
    if (!s || !w) return null;
    return length(sub(w, s));
  }

  function peakSuffix(timestampMs: number): string {
    if (peakImprovedMs !== 0 && timestampMs - peakImprovedMs > PEAK_HOLD_MS) {
      peakDelta = 0;
    }
    return ` pkD=${peakDelta.toFixed(3)}`;
  }

  return {
    update(world, timestampMs, chargeGateOpen): DetectorScore {
      const gate = chargeGateOpen ? 1 : 0;
      if (world) {
        const eL = armExt(world, KEY_JOINT_INDICES.LEFT_SHOULDER, KEY_JOINT_INDICES.LEFT_WRIST);
        const eR = armExt(world, KEY_JOINT_INDICES.RIGHT_SHOULDER, KEY_JOINT_INDICES.RIGHT_WRIST);
        const ext = eL === null ? eR : eR === null ? eL : Math.max(eL, eR);
        if (ext !== null) {
          history.push({ ext, t: timestampMs });
        }
      }
      // 時間窓外の古いサンプルを失効 (履歴クリアはしない)
      const cutoff = timestampMs - params.windowMs;
      while (history.length > 0 && history[0]!.t < cutoff) {
        history.shift();
      }

      if (history.length < 2) {
        return {
          active: false,
          score: 0,
          detail: `ext=- d=- gate=${gate}` + peakSuffix(timestampMs),
        };
      }
      const oldest = history[0]!;
      const newest = history[history.length - 1]!;
      const spanMs = newest.t - oldest.t;
      if (spanMs < params.minWindowMs) {
        return {
          active: false,
          score: 0,
          detail: `ext=${newest.ext.toFixed(2)} d=- gate=${gate}` + peakSuffix(timestampMs),
        };
      }
      const delta = newest.ext - oldest.ext;
      const score = clamp01(delta / params.extBurstDelta);

      if (delta > peakDelta) {
        peakDelta = delta;
        peakImprovedMs = timestampMs;
      }

      const refractory =
        lastFireMs !== null && timestampMs - lastFireMs < params.refractoryMs;
      const active =
        chargeGateOpen &&
        !refractory &&
        delta >= params.extBurstDelta &&
        newest.ext >= params.extHighAbs;
      if (active) {
        lastFireMs = timestampMs;
      }

      const detail =
        `ext=${newest.ext.toFixed(2)} d=${signed(delta, 3)} gate=${gate}` +
        peakSuffix(timestampMs);
      return { active, score, detail };
    },
  };
}

/** spd/dst のピーク保持時間 (ms)。過渡的アタックは瞬間値が読めないため計器で保持。 */
const PEAK_HOLD_MS = 1500;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 常に符号付きで固定幅にする (HUD の桁ぶれ防止)。 */
function signed(v: number, digits: number): string {
  return (v >= 0 ? "+" : "") + v.toFixed(digits);
}
