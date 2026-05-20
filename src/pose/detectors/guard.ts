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
 * ガード姿勢: 両手首が鼻の高さ帯にあり、左右が交差し (左手首が体中心の右側 /
 * 右手首が左側)、顔より前 (z 負方向)。enter は minHoldMs、exit は releaseMs の
 * デバウンス (交差判定の1フレームジッタで落とさない)。active 中は累積持続 ms を
 * detail に出す (デバウンス grace でも held は継続)。detail に生メトリクス
 * (crs/face/fwd) を出し HUD で実測チューニング可能にする。
 */
export function createGuardDetector(
  params: DetectorParams["guard"],
): GuardDetector {
  let active = false;
  let enterCandidateSince: number | null = null;
  let exitCandidateSince: number | null = null;
  let activeSince: number | null = null;

  function evaluate(world: ReadonlyArray<Readonly<Landmark>>): {
    score: number;
    crossed: number;
    faceOk: number;
    fwdOk: number;
  } {
    const ls = jointVec(world, KEY_JOINT_INDICES.LEFT_SHOULDER, DEFAULT_VISIBILITY_THRESHOLD);
    const rs = jointVec(world, KEY_JOINT_INDICES.RIGHT_SHOULDER, DEFAULT_VISIBILITY_THRESHOLD);
    const ns = jointVec(world, KEY_JOINT_INDICES.NOSE, DEFAULT_VISIBILITY_THRESHOLD);
    const lw = jointVec(world, KEY_JOINT_INDICES.LEFT_WRIST, DEFAULT_VISIBILITY_THRESHOLD);
    const rw = jointVec(world, KEY_JOINT_INDICES.RIGHT_WRIST, DEFAULT_VISIBILITY_THRESHOLD);
    if (!ls || !rs || !ns || !lw || !rw) {
      return { score: 0, crossed: 0, faceOk: 0, fwdOk: 0 };
    }

    const center = midpoint(ls, rs);

    const faceL = Math.abs(lw.y - ns.y) <= params.faceBandY;
    const faceR = Math.abs(rw.y - ns.y) <= params.faceBandY;
    const faceOk = faceL && faceR ? 1 : 0;

    const fwdL = ns.z - lw.z >= params.forwardZ;
    const fwdR = ns.z - rw.z >= params.forwardZ;
    const fwdOk = fwdL && fwdR ? 1 : 0;

    // 交差: 左肩は x 正側 (MediaPipe world coords)。非交差時は left wrist が
    // center より x 正、right wrist が x 負。交差時は符号が反転。
    const leftCrossed = lw.x - center.x < 0;
    const rightCrossed = rw.x - center.x > 0;
    const crossed = leftCrossed && rightCrossed ? 1 : 0;

    const score = faceOk && fwdOk && crossed ? 1 : 0;
    return { score, crossed, faceOk, fwdOk };
  }

  return {
    update(world, timestampMs): DetectorScore {
      if (!world) {
        active = false;
        enterCandidateSince = null;
        exitCandidateSince = null;
        activeSince = null;
        return { active: false, score: 0, detail: "crs=- face=- fwd=-" };
      }
      const { score, crossed, faceOk, fwdOk } = evaluate(world);

      if (active) {
        if (score < params.exitScore) {
          if (exitCandidateSince === null) exitCandidateSince = timestampMs;
          if (timestampMs - exitCandidateSince >= params.releaseMs) {
            active = false;
            enterCandidateSince = null;
            exitCandidateSince = null;
            activeSince = null;
          }
        } else {
          exitCandidateSince = null;
        }
      } else {
        if (score >= params.enterScore) {
          if (enterCandidateSince === null) enterCandidateSince = timestampMs;
          if (timestampMs - enterCandidateSince >= params.minHoldMs) {
            active = true;
            activeSince = enterCandidateSince;
            exitCandidateSince = null;
          }
        } else {
          enterCandidateSince = null;
        }
      }

      let detail = `crs=${crossed} face=${faceOk} fwd=${fwdOk}`;
      if (active && activeSince !== null) {
        detail += ` held=${Math.round(timestampMs - activeSince)}ms`;
      }
      return { active, score, detail };
    },
  };
}
