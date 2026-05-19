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
 * アタックのフレーム列 (伸展バースト)。肩を固定し、手首が肩から離れて
 * 腕の伸展量 (肩↔手首距離) が ~0.30m → ~0.52m に急増する。各要素は
 * { world, t } で t は ms (50ms 間隔, 計 6 フレーム / 250ms)。
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
        // 肩から y 方向に ext だけ離す → |wrist - shoulder| = ext
        [K.LEFT_WRIST]: { x: 0.18, y: -0.5 + ext, z: 0 },
        [K.RIGHT_WRIST]: { x: -0.18, y: -0.5 + ext, z: 0 },
      }),
    });
  }
  return frames;
}

/**
 * 伸展が変化しない静止フレーム列 (肩↔手首距離 ~0.30m 一定)。
 * アタック非発火の検証用。
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
        [K.LEFT_WRIST]: { x: 0.18, y: -0.2, z: 0 },
        [K.RIGHT_WRIST]: { x: -0.18, y: -0.2, z: 0 },
      }),
    });
  }
  return frames;
}
