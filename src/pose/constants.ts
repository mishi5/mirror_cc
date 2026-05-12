/**
 * MediaPipe Pose Landmarker の 33 ランドマークのうち、ゲームで使う 9 点のインデックス。
 * 参照: https://developers.google.com/mediapipe/solutions/vision/pose_landmarker
 */
export const KEY_JOINT_INDICES = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
} as const;

/** デバッグオーバーレイで描く骨格の接続。MediaPipe 標準より絞り込んだ最小セット。 */
export const POSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [11, 12], // 肩
  [11, 13],
  [13, 15], // 左腕
  [12, 14],
  [14, 16], // 右腕
  [15, 19], // 左手首-人差し指
  [16, 20], // 右手首-人差し指
];

/** デフォルトの visibility 閾値。これ未満のランドマークは描画/判定から除外する。 */
export const DEFAULT_VISIBILITY_THRESHOLD = 0.5;

/** MediaPipe Pose Landmarker のモデルファイル (Google 公式 CDN, FULL float16)。 */
export const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task";

/** @mediapipe/tasks-vision の WASM (jsDelivr 経由)。 */
export const VISION_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.16/wasm";

/** getUserMedia の希望解像度。実機が下回る場合は自動で fallback。 */
export const WEBCAM_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 30 },
    facingMode: "user",
  },
  audio: false,
};
