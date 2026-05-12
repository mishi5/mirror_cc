import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import {
  DEFAULT_VISIBILITY_THRESHOLD,
  KEY_JOINT_INDICES,
} from "./constants";
import type { KeyJoints } from "./types";

/**
 * 各ランドマークの x を 1 - x に反転する純粋関数。
 *
 * Phase 1 では overlay と video の両方を CSS `transform: scaleX(-1)` でミラー表示しており、
 * 描画用途では本関数を呼ぶ必要がない (二重反転になるため)。
 * 姿勢判定 (Phase 2) でゲーム座標系に変換したい場合などに利用するユーティリティ。
 * 入力配列は変更せず、新しい配列を返す。
 */
export function mirrorLandmarks(
  landmarks: ReadonlyArray<Readonly<NormalizedLandmark>>,
): NormalizedLandmark[] {
  return landmarks.map((lm) => ({
    x: 1 - lm.x,
    y: lm.y,
    z: lm.z,
    visibility: lm.visibility,
  }));
}

/**
 * 33点の中からゲームで使う 9 点を抽出する。33 点未満の場合は例外。
 */
export function selectKeyJoints(
  landmarks: ReadonlyArray<Readonly<NormalizedLandmark>>,
): KeyJoints {
  if (landmarks.length < 33) {
    throw new Error(
      `selectKeyJoints: 33 landmarks required, got ${landmarks.length}`,
    );
  }
  return {
    nose: landmarks[KEY_JOINT_INDICES.NOSE]!,
    leftShoulder: landmarks[KEY_JOINT_INDICES.LEFT_SHOULDER]!,
    rightShoulder: landmarks[KEY_JOINT_INDICES.RIGHT_SHOULDER]!,
    leftElbow: landmarks[KEY_JOINT_INDICES.LEFT_ELBOW]!,
    rightElbow: landmarks[KEY_JOINT_INDICES.RIGHT_ELBOW]!,
    leftWrist: landmarks[KEY_JOINT_INDICES.LEFT_WRIST]!,
    rightWrist: landmarks[KEY_JOINT_INDICES.RIGHT_WRIST]!,
    leftIndex: landmarks[KEY_JOINT_INDICES.LEFT_INDEX]!,
    rightIndex: landmarks[KEY_JOINT_INDICES.RIGHT_INDEX]!,
  };
}

/**
 * ランドマークが描画 / 判定可能なほど信頼できるかを判定する。
 * visibility は MediaPipe が 0..1 で返す。未定義の場合は 0 扱い。
 */
export function isVisible(
  landmark: Readonly<NormalizedLandmark>,
  threshold: number = DEFAULT_VISIBILITY_THRESHOLD,
): boolean {
  return (landmark.visibility ?? 0) >= threshold;
}
