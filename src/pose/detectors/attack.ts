import type { Landmark } from "@mediapipe/tasks-vision";
import { KEY_JOINT_INDICES, DEFAULT_VISIBILITY_THRESHOLD } from "../constants";
import type { DetectorParams } from "./params";
import type { DetectorScore } from "./types";
import { jointVec, sub, length, straightness } from "./geometry";

export interface AttackDetector {
  /**
   * @param chargeGateOpen charge が直近 active だったか (action-detector が判定して渡す)。
   */
  update(
    world: ReadonlyArray<Readonly<Landmark>> | null,
    timestampMs: number,
    chargeGateOpen: boolean,
  ): DetectorScore;
}

/** 片腕の 1 フレーム観測値。null は取得不可。 */
interface ArmReading {
  /** 肩↔手首 3D 距離 (m) */
  readonly ext: number | null;
  /** 肘ストレートネス (0-1, 0.5=90°曲げ, 1.0=180°伸展) */
  readonly straight: number | null;
  /** elbow.y - shoulder.y (m, 正値=肘が肩より下)。arms-down 検知用 */
  readonly elbowDrop: number | null;
}
interface Sample {
  readonly left: ArmReading;
  readonly right: ArmReading;
  readonly t: number;
}

/**
 * アタック検出 — 2 系統の信号を OR 論理 + 幾何ゲートで判定する:
 *
 *  (1) 肩↔手首距離バースト (extBurstDelta + extHighAbs)
 *      横/上方向の腕スイングを捉える (単眼推定では事実上「画像平面の腕長」)。
 *
 *  (2) 肘ストレートネス バースト (straightBurstDelta + straightHighAbs)
 *      肘が曲げ→伸ばしになる動き。前向きパンチでも肘位置は奥行き依存が小さく反応する。
 *
 *  幾何ゲート: 該当腕の elbow が shoulder より maxElbowBelowShoulder 以上下に
 *  あったら「腕が垂れている」とみなし発火しない (arms-down 偽発火を除去)。
 *  前向きパンチ・横スイング・上スイングは肘 ≈ 肩高さなので通る。
 *
 *  左右の腕を個別に評価し、いずれかが信号+幾何を満たせば active。
 *  chargeGateOpen かつ refractory 外も必要。
 *  履歴は時間窓 (windowMs) のリングバッファ、低 visibility / null フレームは
 *  push をスキップするだけで履歴を消さない (モーションブラー耐性)。
 */
export function createAttackDetector(
  params: DetectorParams["attack"],
): AttackDetector {
  const history: Sample[] = [];
  let lastFireMs: number | null = null;
  let peakExtDelta = 0;
  let peakStraightDelta = 0;
  let peakImprovedMs = 0;

  function readArm(
    world: ReadonlyArray<Readonly<Landmark>>,
    shoulderIdx: number,
    elbowIdx: number,
    wristIdx: number,
  ): ArmReading {
    const s = jointVec(world, shoulderIdx, DEFAULT_VISIBILITY_THRESHOLD);
    const e = jointVec(world, elbowIdx, DEFAULT_VISIBILITY_THRESHOLD);
    const w = jointVec(world, wristIdx, DEFAULT_VISIBILITY_THRESHOLD);
    const ext = s !== null && w !== null ? length(sub(w, s)) : null;
    const straight = s !== null && e !== null && w !== null ? straightness(s, e, w) : null;
    const elbowDrop = s !== null && e !== null ? e.y - s.y : null;
    return { ext, straight, elbowDrop };
  }

  function armBurstFires(oldest: ArmReading, newest: ArmReading): boolean {
    // 幾何ゲート: 肘が肩より大きく下に垂れていたら攻撃姿勢ではない
    if (newest.elbowDrop === null) return false;
    if (newest.elbowDrop > params.maxElbowBelowShoulder) return false;
    const extBurst =
      oldest.ext !== null &&
      newest.ext !== null &&
      newest.ext - oldest.ext >= params.extBurstDelta &&
      newest.ext >= params.extHighAbs;
    const straightBurst =
      oldest.straight !== null &&
      newest.straight !== null &&
      newest.straight - oldest.straight >= params.straightBurstDelta &&
      newest.straight >= params.straightHighAbs;
    return extBurst || straightBurst;
  }

  function peakSuffix(timestampMs: number): string {
    if (peakImprovedMs !== 0 && timestampMs - peakImprovedMs > PEAK_HOLD_MS) {
      peakExtDelta = 0;
      peakStraightDelta = 0;
    }
    return ` pkE=${peakExtDelta.toFixed(3)} pkS=${peakStraightDelta.toFixed(2)}`;
  }

  function maxOrNull(a: number | null, b: number | null): number | null {
    if (a === null) return b;
    if (b === null) return a;
    return Math.max(a, b);
  }
  function minOrNull(a: number | null, b: number | null): number | null {
    if (a === null) return b;
    if (b === null) return a;
    return Math.min(a, b);
  }

  return {
    update(world, timestampMs, chargeGateOpen): DetectorScore {
      const gate = chargeGateOpen ? 1 : 0;
      if (world) {
        const left = readArm(
          world,
          KEY_JOINT_INDICES.LEFT_SHOULDER,
          KEY_JOINT_INDICES.LEFT_ELBOW,
          KEY_JOINT_INDICES.LEFT_WRIST,
        );
        const right = readArm(
          world,
          KEY_JOINT_INDICES.RIGHT_SHOULDER,
          KEY_JOINT_INDICES.RIGHT_ELBOW,
          KEY_JOINT_INDICES.RIGHT_WRIST,
        );
        const anyData =
          left.ext !== null ||
          left.straight !== null ||
          right.ext !== null ||
          right.straight !== null;
        if (anyData) {
          history.push({ left, right, t: timestampMs });
        }
      }
      // 時間窓外の古いサンプルを失効
      const cutoff = timestampMs - params.windowMs;
      while (history.length > 0 && history[0]!.t < cutoff) {
        history.shift();
      }

      if (history.length < 2) {
        return {
          active: false,
          score: 0,
          detail:
            `ext=- eΔ=- str=- sΔ=- drop=- gate=${gate}` + peakSuffix(timestampMs),
        };
      }
      const oldest = history[0]!;
      const newest = history[history.length - 1]!;
      const spanMs = newest.t - oldest.t;

      // 表示用集約: 左右の max ext/straight, min drop, max Δ
      const newestExtMax = maxOrNull(newest.left.ext, newest.right.ext);
      const newestStraightMax = maxOrNull(newest.left.straight, newest.right.straight);
      const newestDropMin = minOrNull(newest.left.elbowDrop, newest.right.elbowDrop);
      const oldestExtMax = maxOrNull(oldest.left.ext, oldest.right.ext);
      const oldestStraightMax = maxOrNull(oldest.left.straight, oldest.right.straight);
      const extDelta =
        oldestExtMax !== null && newestExtMax !== null
          ? newestExtMax - oldestExtMax
          : null;
      const straightDelta =
        oldestStraightMax !== null && newestStraightMax !== null
          ? newestStraightMax - oldestStraightMax
          : null;
      // ピーク更新
      if (extDelta !== null && extDelta > peakExtDelta) {
        peakExtDelta = extDelta;
        peakImprovedMs = timestampMs;
      }
      if (straightDelta !== null && straightDelta > peakStraightDelta) {
        peakStraightDelta = straightDelta;
        peakImprovedMs = timestampMs;
      }

      const baseDetail =
        `ext=${formatN(newestExtMax, 2)} eΔ=${formatSigned(extDelta, 3)} ` +
        `str=${formatN(newestStraightMax, 2)} sΔ=${formatSigned(straightDelta, 2)} ` +
        `drop=${formatSigned(newestDropMin, 2)} gate=${gate}` +
        peakSuffix(timestampMs);

      if (spanMs < params.minWindowMs) {
        return { active: false, score: 0, detail: baseDetail };
      }

      const refractory =
        lastFireMs !== null && timestampMs - lastFireMs < params.refractoryMs;
      // 左右の腕を独立に評価し、いずれかが信号+幾何を満たせば発火
      const leftFires = armBurstFires(oldest.left, newest.left);
      const rightFires = armBurstFires(oldest.right, newest.right);
      const active = chargeGateOpen && !refractory && (leftFires || rightFires);
      if (active) {
        lastFireMs = timestampMs;
      }
      // スコアは「より強く burst している側」の正規化値 (最大)
      const extScore =
        extDelta !== null ? clamp01(extDelta / params.extBurstDelta) : 0;
      const straightScore =
        straightDelta !== null ? clamp01(straightDelta / params.straightBurstDelta) : 0;
      const score = Math.max(extScore, straightScore);

      return { active, score, detail: baseDetail };
    },
  };
}

/** ピーク保持時間 (ms)。過渡的アタックの計器用。 */
const PEAK_HOLD_MS = 1500;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function formatN(v: number | null, digits: number): string {
  return v === null ? "-" : v.toFixed(digits);
}

function formatSigned(v: number | null, digits: number): string {
  if (v === null) return "-";
  return (v >= 0 ? "+" : "") + v.toFixed(digits);
}
