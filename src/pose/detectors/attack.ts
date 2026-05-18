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
 * 履歴最古からの前方移動量が minThrustDist 以上。発火後 refractoryMs は再発火しない。
 * 履歴はインスタンス内のリングバッファ (長さ historyLen)。状態はインスタンスに閉じる。
 */
export function createAttackDetector(
  params: DetectorParams["attack"],
): AttackDetector {
  const history: Sample[] = [];
  let lastFireMs: number | null = null;

  function push(s: Sample): void {
    history.push(s);
    if (history.length > params.historyLen) history.shift();
  }

  return {
    update(world, timestampMs): DetectorScore {
      if (!world) {
        return { active: false, score: 0 };
      }
      const lw = jointVec(world, KEY_JOINT_INDICES.LEFT_WRIST, DEFAULT_VISIBILITY_THRESHOLD);
      const rw = jointVec(world, KEY_JOINT_INDICES.RIGHT_WRIST, DEFAULT_VISIBILITY_THRESHOLD);
      if (!lw || !rw) {
        return { active: false, score: 0 };
      }

      push({ lz: lw.z, rz: rw.z, t: timestampMs });
      if (history.length < params.historyLen) {
        return { active: false, score: 0 };
      }

      const oldest = history[0]!;
      const newest = history[history.length - 1]!;
      const dt = (newest.t - oldest.t) / 1000;
      if (dt <= 0) {
        return { active: false, score: 0 };
      }

      // 前方移動量 (z 負方向 = oldest.z - newest.z が正)
      const distL = oldest.lz - newest.lz;
      const distR = oldest.rz - newest.rz;
      const dist = Math.max(distL, distR);
      const speed = dist / dt;

      const score = clamp01(speed / params.thrustSpeed);

      const refractory =
        lastFireMs !== null && timestampMs - lastFireMs < params.refractoryMs;

      const active =
        !refractory &&
        speed >= params.thrustSpeed &&
        dist >= params.minThrustDist;

      if (active) {
        lastFireMs = timestampMs;
      }
      return { active, score };
    },
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
