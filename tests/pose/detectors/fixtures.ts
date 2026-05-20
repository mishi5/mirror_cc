import type { Landmark } from "@mediapipe/tasks-vision";
import { KEY_JOINT_INDICES } from "../../../src/pose/constants";

/** 33 点を visibility 0 のダミーで初期化し、指定 index だけ上書きする。 */
export function makeWorld(
  overrides: Record<number, { x: number; y: number; z: number; visibility?: number }>,
): Landmark[] {
  const world: Landmark[] = [];
  for (let i = 0; i < 33; i++) {
    world.push({ x: 0, y: 0, z: 0, visibility: 0 });
  }
  for (const [idxStr, v] of Object.entries(overrides)) {
    const idx = Number(idxStr);
    world[idx] = { x: v.x, y: v.y, z: v.z, visibility: v.visibility ?? 0.95 };
  }
  return world;
}

const K = KEY_JOINT_INDICES;

/** 直立・腕を下げた idle 姿勢。肩より下に手首、前後 z はほぼ 0。 */
export function idlePose(): Landmark[] {
  return makeWorld({
    [K.NOSE]: { x: 0, y: -0.62, z: -0.02 },
    [K.LEFT_SHOULDER]: { x: 0.18, y: -0.5, z: 0 },
    [K.RIGHT_SHOULDER]: { x: -0.18, y: -0.5, z: 0 },
    [K.LEFT_ELBOW]: { x: 0.2, y: -0.25, z: 0 },
    [K.RIGHT_ELBOW]: { x: -0.2, y: -0.25, z: 0 },
    [K.LEFT_WRIST]: { x: 0.21, y: 0.0, z: 0 },
    [K.RIGHT_WRIST]: { x: -0.21, y: 0.0, z: 0 },
    [K.LEFT_INDEX]: { x: 0.21, y: 0.08, z: 0 },
    [K.RIGHT_INDEX]: { x: -0.21, y: 0.08, z: 0 },
  });
}

/** 両手を体の前 (z 負方向) で胸〜腹の高さ、左右を寄せたチャージ姿勢。 */
export function chargePose(): Landmark[] {
  return makeWorld({
    [K.NOSE]: { x: 0, y: -0.62, z: -0.02 },
    [K.LEFT_SHOULDER]: { x: 0.18, y: -0.5, z: 0 },
    [K.RIGHT_SHOULDER]: { x: -0.18, y: -0.5, z: 0 },
    [K.LEFT_ELBOW]: { x: 0.16, y: -0.3, z: -0.15 },
    [K.RIGHT_ELBOW]: { x: -0.16, y: -0.3, z: -0.15 },
    [K.LEFT_WRIST]: { x: 0.1, y: -0.25, z: -0.28 },
    [K.RIGHT_WRIST]: { x: -0.1, y: -0.25, z: -0.28 },
    [K.LEFT_INDEX]: { x: 0.08, y: -0.25, z: -0.32 },
    [K.RIGHT_INDEX]: { x: -0.08, y: -0.25, z: -0.32 },
  });
}

/** 両手首を顔の高さで左右交差させ、顔の前 (z 負) に置いたガード姿勢。 */
export function guardPose(): Landmark[] {
  return makeWorld({
    [K.NOSE]: { x: 0, y: -0.62, z: -0.02 },
    [K.LEFT_SHOULDER]: { x: 0.18, y: -0.5, z: 0 },
    [K.RIGHT_SHOULDER]: { x: -0.18, y: -0.5, z: 0 },
    [K.LEFT_ELBOW]: { x: 0.1, y: -0.45, z: -0.15 },
    [K.RIGHT_ELBOW]: { x: -0.1, y: -0.45, z: -0.15 },
    [K.LEFT_WRIST]: { x: -0.08, y: -0.6, z: -0.2 },
    [K.RIGHT_WRIST]: { x: 0.08, y: -0.6, z: -0.2 },
    [K.LEFT_INDEX]: { x: -0.1, y: -0.62, z: -0.22 },
    [K.RIGHT_INDEX]: { x: 0.1, y: -0.62, z: -0.22 },
  });
}

/**
 * アタックのフレーム列 (横方向の伸展バースト)。肩を固定し、手首が肩から
 * x 方向 (外側) に離れて伸展量 (肩↔手首距離) が ~0.30 → ~0.52m に急増。
 * 肘は肩と手首の中点に置き、肘の高さは肩と同じ (elbowDrop=0 で幾何ゲート OK)。
 * 50ms 間隔, 計 6 フレーム / 250ms。
 */
export function attackSequence(): ReadonlyArray<{ world: Landmark[]; t: number }> {
  const frames: { world: Landmark[]; t: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const ext = 0.3 + i * 0.044; // 0.300 → 0.520
    frames.push({
      t: i * 50,
      world: makeWorld({
        [K.LEFT_SHOULDER]: { x: 0.18, y: -0.5, z: 0 },
        [K.RIGHT_SHOULDER]: { x: -0.18, y: -0.5, z: 0 },
        // 肩から x 方向 (外側) に ext だけ離す。肘は中点 (肩高さ)。
        [K.LEFT_ELBOW]: { x: 0.18 + ext / 2, y: -0.5, z: 0 },
        [K.RIGHT_ELBOW]: { x: -0.18 - ext / 2, y: -0.5, z: 0 },
        [K.LEFT_WRIST]: { x: 0.18 + ext, y: -0.5, z: 0 },
        [K.RIGHT_WRIST]: { x: -0.18 - ext, y: -0.5, z: 0 },
      }),
    });
  }
  return frames;
}

/**
 * 前向きパンチのフレーム列 (肘が曲げ→伸びへ)。肩・肘・手首の3点で肘角度を
 * 90°(straightness 0.5) → 180°(straightness 1.0) に動かす。前向きでも
 * 肘角度信号で反応することを検証する用 (worldLandmarks の z は使わない)。
 */
export function forwardPunchSequence(): ReadonlyArray<{
  world: Landmark[];
  t: number;
}> {
  const frames: { world: Landmark[]; t: number }[] = [];
  for (let i = 0; i < 6; i++) {
    // i=0 で θ=90° (bent), i=5 で θ=0° (straight)
    const thetaDeg = 90 - i * 18;
    const th = (thetaDeg * Math.PI) / 180;
    const fc = Math.cos(th);
    const fs = Math.sin(th);
    // 左腕: shoulder=(0.18,-0.5,0), elbow=(0.43,-0.5,0) (上腕は +x 方向)
    // 前腕: cos(θ)*+x_direction + sin(θ)*-y_direction
    const lElbow = { x: 0.43, y: -0.5, z: 0 };
    const lWrist = { x: 0.43 + 0.25 * fc, y: -0.5 - 0.25 * fs, z: 0 };
    const rElbow = { x: -0.43, y: -0.5, z: 0 };
    const rWrist = { x: -0.43 - 0.25 * fc, y: -0.5 - 0.25 * fs, z: 0 };
    frames.push({
      t: i * 50,
      world: makeWorld({
        [K.LEFT_SHOULDER]: { x: 0.18, y: -0.5, z: 0 },
        [K.RIGHT_SHOULDER]: { x: -0.18, y: -0.5, z: 0 },
        [K.LEFT_ELBOW]: lElbow,
        [K.RIGHT_ELBOW]: rElbow,
        [K.LEFT_WRIST]: lWrist,
        [K.RIGHT_WRIST]: rWrist,
      }),
    });
  }
  return frames;
}

/**
 * 伸展も角度も変化しない静止フレーム列 (一定の構え)。
 * 幾何ゲートは満たすが信号が動かない → 非発火の検証用。
 */
export function flatExtensionSequence(): ReadonlyArray<{
  world: Landmark[];
  t: number;
}> {
  const frames: { world: Landmark[]; t: number }[] = [];
  for (let i = 0; i < 8; i++) {
    frames.push({
      t: i * 50,
      world: makeWorld({
        [K.LEFT_SHOULDER]: { x: 0.18, y: -0.5, z: 0 },
        [K.RIGHT_SHOULDER]: { x: -0.18, y: -0.5, z: 0 },
        // 肘を肩高さに置き幾何ゲート OK にする (信号が動かないことだけで弾きたい)
        [K.LEFT_ELBOW]: { x: 0.33, y: -0.5, z: 0 },
        [K.RIGHT_ELBOW]: { x: -0.33, y: -0.5, z: 0 },
        [K.LEFT_WRIST]: { x: 0.48, y: -0.5, z: 0 },
        [K.RIGHT_WRIST]: { x: -0.48, y: -0.5, z: 0 },
      }),
    });
  }
  return frames;
}

/**
 * 腕が垂れた状態でストレートネスが上がる False positive 検証列。
 * 肘は肩より大きく下 (drop ≈ 0.30) で straightness 0.5 → 1.0 に変化。
 * 新しい幾何ゲート (maxElbowBelowShoulder) で発火しないことを検証する。
 */
export function armsDownStraightenSequence(): ReadonlyArray<{
  world: Landmark[];
  t: number;
}> {
  const frames: { world: Landmark[]; t: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const thetaDeg = 90 - i * 18; // 90°→0°
    const th = (thetaDeg * Math.PI) / 180;
    const fc = Math.cos(th);
    const fs = Math.sin(th);
    // 肘を肩より 0.30m 下に固定 (腕が垂れている)
    const lElbow = { x: 0.18, y: -0.2, z: 0 };
    const lWrist = { x: 0.18 + 0.25 * fs, y: -0.2 + 0.25 * fc, z: 0 };
    const rElbow = { x: -0.18, y: -0.2, z: 0 };
    const rWrist = { x: -0.18 - 0.25 * fs, y: -0.2 + 0.25 * fc, z: 0 };
    frames.push({
      t: i * 50,
      world: makeWorld({
        [K.LEFT_SHOULDER]: { x: 0.18, y: -0.5, z: 0 },
        [K.RIGHT_SHOULDER]: { x: -0.18, y: -0.5, z: 0 },
        [K.LEFT_ELBOW]: lElbow,
        [K.RIGHT_ELBOW]: rElbow,
        [K.LEFT_WRIST]: lWrist,
        [K.RIGHT_WRIST]: rWrist,
      }),
    });
  }
  return frames;
}
