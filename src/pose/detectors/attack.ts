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

interface Sample {
  /** 肩↔手首の 3D 距離の最大 (左右どちらか伸びている方, m)。未取得は null */
  readonly extMax: number | null;
  /** 肘ストレートネスの最大 (左右どちらか) 0-1。未取得は null */
  readonly straightMax: number | null;
  readonly t: number;
}

/**
 * アタック検出は2系統の信号を OR 論理で組み合わせる:
 *
 *  (1) 肩↔手首距離バースト (extBurstDelta + extHighAbs)
 *      横/上方向の腕スイングを捉える。前向きパンチ (カメラ方向) は単眼推定で
 *      奥行きが潰れて 3D 距離が変わりにくいため反応しにくい。
 *
 *  (2) 肘ストレートネス バースト (straightBurstDelta + straightHighAbs)
 *      肘の角度が曲げ (90°≈0.5) から伸ばし (180°≈1.0) になる動きを捉える。
 *      MediaPipe の単眼でも肘位置は奥行き依存が小さく、前向きパンチでも反応する。
 *
 * いずれかが閾値を超え、かつ chargeGateOpen かつ refractory 外なら active。
 * 履歴は時間窓 (windowMs) でリングバッファ。低 visibility / null フレームは
 * push をスキップするだけで履歴を消さない (モーションブラー耐性)。
 */
export function createAttackDetector(
  params: DetectorParams["attack"],
): AttackDetector {
  const history: Sample[] = [];
  let lastFireMs: number | null = null;
  let peakExtDelta = 0;
  let peakStraightDelta = 0;
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

  function armStraight(
    world: ReadonlyArray<Readonly<Landmark>>,
    shoulderIdx: number,
    elbowIdx: number,
    wristIdx: number,
  ): number | null {
    const s = jointVec(world, shoulderIdx, DEFAULT_VISIBILITY_THRESHOLD);
    const e = jointVec(world, elbowIdx, DEFAULT_VISIBILITY_THRESHOLD);
    const w = jointVec(world, wristIdx, DEFAULT_VISIBILITY_THRESHOLD);
    if (!s || !e || !w) return null;
    return straightness(s, e, w);
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

  return {
    update(world, timestampMs, chargeGateOpen): DetectorScore {
      const gate = chargeGateOpen ? 1 : 0;
      if (world) {
        const eL = armExt(world, KEY_JOINT_INDICES.LEFT_SHOULDER, KEY_JOINT_INDICES.LEFT_WRIST);
        const eR = armExt(world, KEY_JOINT_INDICES.RIGHT_SHOULDER, KEY_JOINT_INDICES.RIGHT_WRIST);
        const sL = armStraight(
          world,
          KEY_JOINT_INDICES.LEFT_SHOULDER,
          KEY_JOINT_INDICES.LEFT_ELBOW,
          KEY_JOINT_INDICES.LEFT_WRIST,
        );
        const sR = armStraight(
          world,
          KEY_JOINT_INDICES.RIGHT_SHOULDER,
          KEY_JOINT_INDICES.RIGHT_ELBOW,
          KEY_JOINT_INDICES.RIGHT_WRIST,
        );
        const extMax = maxOrNull(eL, eR);
        const straightMax = maxOrNull(sL, sR);
        if (extMax !== null || straightMax !== null) {
          history.push({ extMax, straightMax, t: timestampMs });
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
          detail: `ext=- eΔ=- str=- sΔ=- gate=${gate}` + peakSuffix(timestampMs),
        };
      }
      const oldest = history[0]!;
      const newest = history[history.length - 1]!;
      const spanMs = newest.t - oldest.t;
      if (spanMs < params.minWindowMs) {
        return {
          active: false,
          score: 0,
          detail:
            `ext=${formatN(newest.extMax, 2)} eΔ=- ` +
            `str=${formatN(newest.straightMax, 2)} sΔ=- gate=${gate}` +
            peakSuffix(timestampMs),
        };
      }

      // 各信号で「最古→最新の増加量」と「最新の絶対値」を見る
      const extOk =
        oldest.extMax !== null &&
        newest.extMax !== null &&
        newest.extMax - oldest.extMax >= params.extBurstDelta &&
        newest.extMax >= params.extHighAbs;
      const straightOk =
        oldest.straightMax !== null &&
        newest.straightMax !== null &&
        newest.straightMax - oldest.straightMax >= params.straightBurstDelta &&
        newest.straightMax >= params.straightHighAbs;

      const extDelta =
        oldest.extMax !== null && newest.extMax !== null
          ? newest.extMax - oldest.extMax
          : null;
      const straightDelta =
        oldest.straightMax !== null && newest.straightMax !== null
          ? newest.straightMax - oldest.straightMax
          : null;

      // ピーク更新 (HUD のチューニング用)
      if (extDelta !== null && extDelta > peakExtDelta) {
        peakExtDelta = extDelta;
        peakImprovedMs = timestampMs;
      }
      if (straightDelta !== null && straightDelta > peakStraightDelta) {
        peakStraightDelta = straightDelta;
        peakImprovedMs = timestampMs;
      }

      // スコアは「より強く burst している信号」の正規化値
      const extScore =
        extDelta !== null ? clamp01(extDelta / params.extBurstDelta) : 0;
      const straightScore =
        straightDelta !== null
          ? clamp01(straightDelta / params.straightBurstDelta)
          : 0;
      const score = Math.max(extScore, straightScore);

      const refractory =
        lastFireMs !== null && timestampMs - lastFireMs < params.refractoryMs;
      const active = chargeGateOpen && !refractory && (extOk || straightOk);
      if (active) {
        lastFireMs = timestampMs;
      }

      const detail =
        `ext=${formatN(newest.extMax, 2)} eΔ=${formatSigned(extDelta, 3)} ` +
        `str=${formatN(newest.straightMax, 2)} sΔ=${formatSigned(straightDelta, 2)} ` +
        `gate=${gate}` +
        peakSuffix(timestampMs);
      return { active, score, detail };
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
