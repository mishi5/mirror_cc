import type { Landmark } from "@mediapipe/tasks-vision";
import { KEY_JOINT_INDICES, DEFAULT_VISIBILITY_THRESHOLD } from "../constants";
import type { DetectorParams } from "./params";
import type { DetectorScore } from "./types";
import { jointVec } from "./geometry";

export interface AttackDetector {
  update(
    world: ReadonlyArray<Readonly<Landmark>> | null,
    timestampMs: number,
  ): DetectorScore;
}

interface Sample {
  readonly lz: number;
  readonly rz: number;
  readonly t: number;
}

/**
 * アタック: 左右どちらかの手首が前方 (z 負方向) へ thrustSpeed (m/s) 以上で移動し、
 * 時間窓内 oldest→newest の前方移動量が minThrustDist 以上。発火後 refractoryMs は再発火しない。
 *
 * 設計: 時間ベースの窓 (windowMs)。低 visibility / 未検出フレームは「サンプルを追加
 * しないだけ」で履歴は消さない。これにより速い突き出し中のモーションブラー (一時的な
 * visibility 低下) で窓が壊れない。古いサンプルは windowMs の時間失効で自然に消えるため、
 * 長時間の不在は自己回復する (frame-count ではなく時間基準なのでフレームレート非依存)。
 *
 * 履歴・lastFireMs はインスタンスに閉じる (将来 Map<poseIndex,...> で2人化)。
 */
/**
 * spd/dst の直近ピークを保持する時間 (ms)。過渡的なアタックは瞬間値が読めないため、
 * この期間の最大値を HUD に出して実測チューニングに使う。期間経過で 0 に減衰。
 */
const PEAK_HOLD_MS = 1500;

export function createAttackDetector(
  params: DetectorParams["attack"],
): AttackDetector {
  const history: Sample[] = [];
  let lastFireMs: number | null = null;
  // 直近 PEAK_HOLD_MS の spd/dst ピーク (計器用)
  let peakSpeed = 0;
  let peakDist = 0;
  let peakImprovedMs = 0;

  function peakDetailSuffix(timestampMs: number): string {
    if (peakImprovedMs !== 0 && timestampMs - peakImprovedMs > PEAK_HOLD_MS) {
      peakSpeed = 0;
      peakDist = 0;
    }
    return ` pkS=${peakSpeed.toFixed(2)} pkD=${peakDist.toFixed(3)}`;
  }

  return {
    update(world, timestampMs): DetectorScore {
      if (world) {
        const lw = jointVec(world, KEY_JOINT_INDICES.LEFT_WRIST, DEFAULT_VISIBILITY_THRESHOLD);
        const rw = jointVec(world, KEY_JOINT_INDICES.RIGHT_WRIST, DEFAULT_VISIBILITY_THRESHOLD);
        if (lw && rw) {
          history.push({ lz: lw.z, rz: rw.z, t: timestampMs });
        }
      }
      // 時間窓外の古いサンプルを失効 (履歴クリアはしない)
      const cutoff = timestampMs - params.windowMs;
      while (history.length > 0 && history[0]!.t < cutoff) {
        history.shift();
      }

      if (history.length < 2) {
        return { active: false, score: 0, detail: "spd=- dst=-" + peakDetailSuffix(timestampMs) };
      }
      const oldest = history[0]!;
      const newest = history[history.length - 1]!;
      const spanMs = newest.t - oldest.t;
      if (spanMs < params.minWindowMs) {
        return { active: false, score: 0, detail: "spd=- dst=-" + peakDetailSuffix(timestampMs) };
      }
      const dt = spanMs / 1000;
      const distL = oldest.lz - newest.lz;
      const distR = oldest.rz - newest.rz;
      const dist = Math.max(distL, distR);
      const speed = dist / dt;
      const score = clamp01(speed / params.thrustSpeed);

      // ピーク更新 (計器用)
      if (speed > peakSpeed) {
        peakSpeed = speed;
        peakImprovedMs = timestampMs;
      }
      if (dist > peakDist) {
        peakDist = dist;
        peakImprovedMs = timestampMs;
      }

      const refractory =
        lastFireMs !== null && timestampMs - lastFireMs < params.refractoryMs;
      const active =
        !refractory && speed >= params.thrustSpeed && dist >= params.minThrustDist;
      if (active) {
        lastFireMs = timestampMs;
      }

      const detail =
        `spd=${speed.toFixed(2)} dst=${dist.toFixed(3)}` +
        peakDetailSuffix(timestampMs);
      return { active, score, detail };
    },
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
