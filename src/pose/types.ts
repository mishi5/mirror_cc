import type { NormalizedLandmark, Landmark } from "@mediapipe/tasks-vision";

/**
 * 1人分の姿勢推定結果。MediaPipe の raw 出力を最小限に整形した内部表現。
 * landmarks は画像正規化座標 (0..1)。worldLandmarks は腰中点を原点とするメートル単位 3D。
 */
export interface PoseFrame {
  /** 推論完了時の performance.now() */
  readonly timestamp: number;
  /** 33点のランドマーク (画像正規化座標)。ミラー反転前。 */
  readonly landmarks: ReadonlyArray<NormalizedLandmark>;
  /** 33点のワールドランドマーク (腰中点原点, メートル)。Phase 4 で利用予定。 */
  readonly worldLandmarks: ReadonlyArray<Landmark>;
  /** detectForVideo にかかった時間 (ms)。HUD 表示用。 */
  readonly detectTimeMs: number;
}

/**
 * ゲームで使う 9 点の主要ジョイント。selectKeyJoints の戻り値。
 */
export interface KeyJoints {
  readonly nose: NormalizedLandmark;
  readonly leftShoulder: NormalizedLandmark;
  readonly rightShoulder: NormalizedLandmark;
  readonly leftElbow: NormalizedLandmark;
  readonly rightElbow: NormalizedLandmark;
  readonly leftWrist: NormalizedLandmark;
  readonly rightWrist: NormalizedLandmark;
  readonly leftIndex: NormalizedLandmark;
  readonly rightIndex: NormalizedLandmark;
}

/**
 * UI 状態 (ローディング / エラー / 通常)。ui/status.ts で参照。
 */
export type AppStatus =
  | { readonly kind: "loading"; readonly message: string }
  | { readonly kind: "error"; readonly message: string; readonly retryLabel?: string }
  | { readonly kind: "ok" };
