import type { Landmark } from "@mediapipe/tasks-vision";
import { KEY_JOINT_INDICES, DEFAULT_VISIBILITY_THRESHOLD } from "../constants";
import type { DetectorParams } from "./params";
import type { DetectorScore } from "./types";
import { jointVec, midpoint, length, sub, type Vec3 } from "./geometry";

export interface ChargeDetector {
  update(
    world: ReadonlyArray<Readonly<Landmark>> | null,
    timestampMs: number,
  ): DetectorScore;
}

/**
 * チャージ姿勢: 両手首が両肩より前 (z 負方向)、肩 y を基準とした高さ帯に収まり、
 * 左右手首間が一定距離以内 (体の前に寄せている)。
 * さらに「手首が顔の高さ (鼻 ± faceExclY)」のときは guard 領域として除外する
 * (charge=胸〜腹 と guard=顔前 を構造的に排他化し、guard フリッカ時の charge 露出を防ぐ)。
 * raw スコア (0..1) に enter/exit ヒステリシスと minHoldMs を適用する。
 * detail に内部メトリクス (fwd/bnd/cls/fex) を出し HUD で実測チューニング可能にする。
 */
export function createChargeDetector(
  params: DetectorParams["charge"],
): ChargeDetector {
  let active = false;
  let enterCandidateSince: number | null = null;
  let exitCandidateSince: number | null = null;

  function evaluate(world: ReadonlyArray<Readonly<Landmark>>): {
    score: number;
    detail: string;
  } {
    const ls = jointVec(world, KEY_JOINT_INDICES.LEFT_SHOULDER, DEFAULT_VISIBILITY_THRESHOLD);
    const rs = jointVec(world, KEY_JOINT_INDICES.RIGHT_SHOULDER, DEFAULT_VISIBILITY_THRESHOLD);
    const lw = jointVec(world, KEY_JOINT_INDICES.LEFT_WRIST, DEFAULT_VISIBILITY_THRESHOLD);
    const rw = jointVec(world, KEY_JOINT_INDICES.RIGHT_WRIST, DEFAULT_VISIBILITY_THRESHOLD);
    if (!ls || !rs || !lw || !rw) {
      return { score: 0, detail: "fwd=- bnd=- cls=- fex=-" };
    }

    // 顔の高さ除外: 鼻が見えていて、どちらかの手首が鼻 y ± faceExclY にあれば
    // それは guard 領域なので charge から除外する。鼻が見えない場合はゲート無効。
    const ns = jointVec(world, KEY_JOINT_INDICES.NOSE, DEFAULT_VISIBILITY_THRESHOLD);
    let faceExcluded = false;
    if (ns) {
      const nearFaceL = Math.abs(lw.y - ns.y) <= params.faceExclY;
      const nearFaceR = Math.abs(rw.y - ns.y) <= params.faceExclY;
      faceExcluded = nearFaceL || nearFaceR;
    }

    const shoulder: Vec3 = midpoint(ls, rs);

    const fwdL = (shoulder.z - lw.z) / params.forwardZ;
    const fwdR = (shoulder.z - rw.z) / params.forwardZ;
    const forward = clamp01(Math.min(fwdL, fwdR));

    // band は二値 hard gate (高さは合否制約。forward/closeness の連続値とは非対称)
    const inBandL = inBand(lw.y, shoulder.y + params.yBandLow, shoulder.y + params.yBandHigh);
    const inBandR = inBand(rw.y, shoulder.y + params.yBandLow, shoulder.y + params.yBandHigh);
    const band = inBandL && inBandR ? 1 : 0;

    // spread を maxHandSpread で正規化 (spread = 2*maxHandSpread で closeness=0)
    const spread = length(sub(lw, rw));
    const closeness = clamp01(1 - Math.max(0, spread - params.maxHandSpread) / params.maxHandSpread);

    const score = faceExcluded ? 0 : forward * band * closeness;
    const detail =
      `fwd=${forward.toFixed(2)} bnd=${band} ` +
      `cls=${closeness.toFixed(2)} fex=${faceExcluded ? 1 : 0}`;
    return { score, detail };
  }

  return {
    update(world, timestampMs): DetectorScore {
      if (!world) {
        active = false;
        enterCandidateSince = null;
        exitCandidateSince = null;
        return { active: false, score: 0, detail: "fwd=- bnd=- cls=- fex=-" };
      }
      const { score, detail } = evaluate(world);

      if (active) {
        if (score < params.exitScore) {
          if (exitCandidateSince === null) exitCandidateSince = timestampMs;
          if (timestampMs - exitCandidateSince >= params.releaseMs) {
            active = false;
            enterCandidateSince = null;
            exitCandidateSince = null;
          }
        } else {
          exitCandidateSince = null;
        }
      } else {
        if (score >= params.enterScore) {
          if (enterCandidateSince === null) enterCandidateSince = timestampMs;
          if (timestampMs - enterCandidateSince >= params.minHoldMs) {
            active = true;
            exitCandidateSince = null;
          }
        } else {
          enterCandidateSince = null;
        }
      }
      return { active, score, detail };
    },
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function inBand(v: number, lo: number, hi: number): boolean {
  return v >= lo && v <= hi;
}
