import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { POSE_MODEL_URL, VISION_WASM_URL } from "./constants";
import type { PoseFrame } from "./types";

async function createWithDelegate(
  delegate: "GPU" | "CPU",
): Promise<PoseLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(VISION_WASM_URL);
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: POSE_MODEL_URL,
      delegate,
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });
}

/**
 * MediaPipe Pose Landmarker のラッパ。VIDEO モードで 1 人のみ検出。
 * GPU delegate で起動を試み、失敗した場合 (WebGL2 / WebGPU が無いブラウザ等)
 * CPU delegate にフォールバックする。両方失敗した場合は最後の例外を throw する。
 */
export async function createPoseLandmarker(): Promise<PoseLandmarker> {
  try {
    return await createWithDelegate("GPU");
  } catch (gpuErr) {
    console.warn("MediaPipe GPU delegate unavailable, falling back to CPU:", gpuErr);
    return createWithDelegate("CPU");
  }
}

/**
 * 1 フレーム分の推論を行い PoseFrame に整形する。
 * pose が検出できなかった (landmarks 空) 場合は null を返す。
 * timestamp は performance.now() を渡すこと (MediaPipe は単調増加を要求)。
 *
 * 注: PoseLandmarkerResult は WASM ヒープ上のオブジェクトを保持するため
 * 30fps で呼ぶとメモリリークになる。フィールド取り出し後に result.close() を呼ぶ。
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
  result.close();

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
