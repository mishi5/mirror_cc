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
 *
 * 前提: 両手首が visibility 閾値を超えて初めて 1 サンプルを記録する。どちらかが
 * 低 visibility / 未検出のフレームは履歴をクリアして idle 復帰する (charge/guard と
 * 同じ状態リセット方針。resume 後は historyLen フレーム分の warm-up を経て再評価)。
 *
 * チューニング注記: historyLen を大きくすると速度推定は安定するが、検出開始
 * (および dropout からの復帰) までに historyLen フレーム分の遅延が出る。
 * 実機 60fps (~16ms/frame) で historyLen=6 なら warm-up ≈ 83ms。
 *
 * 履歴はインスタンス内のリングバッファ。state はインスタンスに閉じる
 * (将来 Map<poseIndex,...> で2人化)。dt は newest.t-oldest.t を使うため
 * フレームレート非依存。
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
        history.length = 0;
        return { active: false, score: 0 };
      }
      const lw = jointVec(world, KEY_JOINT_INDICES.LEFT_WRIST, DEFAULT_VISIBILITY_THRESHOLD);
      const rw = jointVec(world, KEY_JOINT_INDICES.RIGHT_WRIST, DEFAULT_VISIBILITY_THRESHOLD);
      if (!lw || !rw) {
        history.length = 0;
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
