import type { Landmark } from "@mediapipe/tasks-vision";
import { KEY_JOINT_INDICES, DEFAULT_VISIBILITY_THRESHOLD } from "../constants";
import type { DetectorParams } from "./params";
import type { DetectorScore } from "./types";
import { jointVec, midpoint, length, type Vec3 } from "./geometry";

export interface ChargeDetector {
  update(
    world: ReadonlyArray<Readonly<Landmark>> | null,
    timestampMs: number,
  ): DetectorScore;
}

/**
 * チャージ姿勢: 両手首が両肩より前 (z 負方向)、肩 y を基準とした高さ帯に収まり、
 * 左右手首間が一定距離以内 (体の前に寄せている)。
 * raw スコア (0..1) に enter/exit ヒステリシスと minHoldMs を適用する。
 */
export function createChargeDetector(
  params: DetectorParams["charge"],
): ChargeDetector {
  let active = false;
  let enterCandidateSince: number | null = null;

  function rawScore(world: ReadonlyArray<Readonly<Landmark>>): number {
    const ls = jointVec(world, KEY_JOINT_INDICES.LEFT_SHOULDER, DEFAULT_VISIBILITY_THRESHOLD);
    const rs = jointVec(world, KEY_JOINT_INDICES.RIGHT_SHOULDER, DEFAULT_VISIBILITY_THRESHOLD);
    const lw = jointVec(world, KEY_JOINT_INDICES.LEFT_WRIST, DEFAULT_VISIBILITY_THRESHOLD);
    const rw = jointVec(world, KEY_JOINT_INDICES.RIGHT_WRIST, DEFAULT_VISIBILITY_THRESHOLD);
    if (!ls || !rs || !lw || !rw) return 0;

    const shoulder: Vec3 = midpoint(ls, rs);

    const fwdL = (shoulder.z - lw.z) / params.forwardZ;
    const fwdR = (shoulder.z - rw.z) / params.forwardZ;
    const forward = clamp01(Math.min(fwdL, fwdR));

    const inBandL = inBand(lw.y, shoulder.y + params.yBandLow, shoulder.y + params.yBandHigh);
    const inBandR = inBand(rw.y, shoulder.y + params.yBandLow, shoulder.y + params.yBandHigh);
    const band = inBandL && inBandR ? 1 : 0;

    const spread = length({ x: lw.x - rw.x, y: lw.y - rw.y, z: lw.z - rw.z });
    const closeness = clamp01(1 - Math.max(0, spread - params.maxHandSpread) / params.maxHandSpread);

    return forward * band * closeness;
  }

  return {
    update(world, timestampMs): DetectorScore {
      if (!world) {
        active = false;
        enterCandidateSince = null;
        return { active: false, score: 0 };
      }
      const score = rawScore(world);

      if (active) {
        if (score < params.exitScore) {
          active = false;
          enterCandidateSince = null;
        }
      } else {
        if (score >= params.enterScore) {
          if (enterCandidateSince === null) enterCandidateSince = timestampMs;
          if (timestampMs - enterCandidateSince >= params.minHoldMs) {
            active = true;
          }
        } else {
          enterCandidateSince = null;
        }
      }
      return { active, score };
    },
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function inBand(v: number, lo: number, hi: number): boolean {
  return v >= lo && v <= hi;
}
