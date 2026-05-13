import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { POSE_MODEL_URL, VISION_WASM_URL } from "./constants";
import type { PoseFrame } from "./types";

/**
 * MediaPipe Pose Landmarker のラッパ。VIDEO モードで 1 人のみ検出。
 * createPoseLandmarker は WASM とモデルの非同期取得を含み、失敗時は throw する。
 */
export async function createPoseLandmarker(): Promise<PoseLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(VISION_WASM_URL);
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: POSE_MODEL_URL,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });
}

/**
 * 1 フレーム分の推論を行い PoseFrame に整形する。
 * pose が検出できなかった (landmarks 空) 場合は null を返す。
 * timestamp は performance.now() を渡すこと (MediaPipe は単調増加を要求)。
 */
export function detectPose(
  landmarker: PoseLandmarker,
  video: HTMLVideoElement,
  timestampMs: number,
): PoseFrame | null {
  const start = performance.now();
  const result: PoseLandmarkerResult = landmarker.detectForVideo(video, timestampMs);
  const detectTimeMs = performance.now() - start;

  const first = result.landmarks[0];
  const firstWorld = result.worldLandmarks[0];
  if (!first || !firstWorld) {
    return null;
  }
  return {
    timestamp: timestampMs,
    landmarks: first,
    worldLandmarks: firstWorld,
    detectTimeMs,
  };
}
