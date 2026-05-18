import type { Landmark } from "@mediapipe/tasks-vision";
import { KEY_JOINT_INDICES, DEFAULT_VISIBILITY_THRESHOLD } from "../constants";
import type { DetectorParams } from "./params";
import type { DetectorScore } from "./types";
import { jointVec, midpoint } from "./geometry";

export interface GuardDetector {
  update(
    world: ReadonlyArray<Readonly<Landmark>> | null,
    timestampMs: number,
  ): DetectorScore;
}

/**
 * ガード姿勢: 両手首が鼻の高さ帯にあり、左右が交差し (左手首が体中心の右側 / 右手首が左側)、
 * 顔より前 (z 負方向)。enter/exit ヒステリシス + minHoldMs。active 中は累積持続 ms を detail に出す。
 */
export function createGuardDetector(
  params: DetectorParams["guard"],
): GuardDetector {
  let active = false;
  let enterCandidateSince: number | null = null;
  let activeSince: number | null = null;

  function rawScore(world: ReadonlyArray<Readonly<Landmark>>): number {
    const ls = jointVec(world, KEY_JOINT_INDICES.LEFT_SHOULDER, DEFAULT_VISIBILITY_THRESHOLD);
    const rs = jointVec(world, KEY_JOINT_INDICES.RIGHT_SHOULDER, DEFAULT_VISIBILITY_THRESHOLD);
    const ns = jointVec(world, KEY_JOINT_INDICES.NOSE, DEFAULT_VISIBILITY_THRESHOLD);
    const lw = jointVec(world, KEY_JOINT_INDICES.LEFT_WRIST, DEFAULT_VISIBILITY_THRESHOLD);
    const rw = jointVec(world, KEY_JOINT_INDICES.RIGHT_WRIST, DEFAULT_VISIBILITY_THRESHOLD);
    if (!ls || !rs || !ns || !lw || !rw) return 0;

    const center = midpoint(ls, rs);

    // 高さ: 両手首が鼻 y ± faceBandY
    const faceL = Math.abs(lw.y - ns.y) <= params.faceBandY;
    const faceR = Math.abs(rw.y - ns.y) <= params.faceBandY;
    if (!faceL || !faceR) return 0;

    // 前方: 両手首が鼻より z 負方向に forwardZ 以上
    const fwdL = ns.z - lw.z >= params.forwardZ;
    const fwdR = ns.z - rw.z >= params.forwardZ;
    if (!fwdL || !fwdR) return 0;

    // rawScore は 0 か 1 の二値 (crossed)。enterScore/exitScore は形式上
    // ヒステリシス境界だが、実効的には "0.5 を境に on/off" と同等。
    // 交差度を将来連続値化する場合はここを変更する。
    // 交差: 左肩は x 正側 (MediaPipe world coords)。
    // 非交差時は left wrist が center より x 正、right wrist が x 負。
    // 交差時は符号が反転する。両手首が反対側に来たら 1。
    const leftCrossed = lw.x - center.x < 0;
    const rightCrossed = rw.x - center.x > 0;
    const crossed = leftCrossed && rightCrossed ? 1 : 0;

    return crossed;
  }

  return {
    update(world, timestampMs): DetectorScore {
      if (!world) {
        active = false;
        enterCandidateSince = null;
        activeSince = null;
        return { active: false, score: 0 };
      }
      const score = rawScore(world);

      if (active) {
        if (score < params.exitScore) {
          active = false;
          enterCandidateSince = null;
          activeSince = null;
        }
      } else {
        if (score >= params.enterScore) {
          if (enterCandidateSince === null) enterCandidateSince = timestampMs;
          if (timestampMs - enterCandidateSince >= params.minHoldMs) {
            active = true;
            activeSince = enterCandidateSince;
          }
        } else {
          enterCandidateSince = null;
        }
      }

      const detail =
        active && activeSince !== null
          ? `held=${Math.round(timestampMs - activeSince)}ms`
          : undefined;
      return { active, score, detail };
    },
  };
}
