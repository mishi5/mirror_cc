import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { POSE_CONNECTIONS, DEFAULT_VISIBILITY_THRESHOLD } from "../pose/constants";
import { isVisible } from "../pose/transforms";

const LANDMARK_COLOR = "#44aaff";
const CONNECTION_COLOR = "#ffffff";
const LANDMARK_RADIUS_PX = 6;
const CONNECTION_WIDTH_PX = 3;

/**
 * 2D Canvas に landmark と connection を描画する。
 * landmarks は画像正規化座標 (0..1)。canvas サイズと演算で px に変換する。
 * visibility 閾値以下のランドマーク・接続は描画しない。
 *
 * canvas は CSS で webcam と同一サイズに重ねており、`transform: scaleX(-1)` で
 * ミラー反転されているため、x の反転は CSS 任せにし overlay 側では行わない。
 *
 * @param ctx canvas の 2D context (setTransform で DPR スケール済み)
 * @param landmarks 33点のランドマーク (raw、ミラー反転前)
 * @param width  **CSS 論理ピクセル幅** (canvas.width ではなく getBoundingClientRect().width)。
 *               canvas.width を渡すと DPR が二重に適用され座標が画面外にずれる。
 * @param height CSS 論理ピクセル高さ
 * @param threshold visibility のフィルタ閾値 (デフォルト DEFAULT_VISIBILITY_THRESHOLD)
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  landmarks: ReadonlyArray<Readonly<NormalizedLandmark>>,
  width: number,
  height: number,
  threshold: number = DEFAULT_VISIBILITY_THRESHOLD,
): void {
  ctx.clearRect(0, 0, width, height);
  if (landmarks.length === 0) return;

  ctx.strokeStyle = CONNECTION_COLOR;
  ctx.lineWidth = CONNECTION_WIDTH_PX;
  ctx.lineCap = "round";
  for (const [a, b] of POSE_CONNECTIONS) {
    const la = landmarks[a];
    const lb = landmarks[b];
    if (!la || !lb) continue;
    if (!isVisible(la, threshold) || !isVisible(lb, threshold)) continue;
    ctx.beginPath();
    ctx.moveTo(la.x * width, la.y * height);
    ctx.lineTo(lb.x * width, lb.y * height);
    ctx.stroke();
  }

  ctx.fillStyle = LANDMARK_COLOR;
  for (const lm of landmarks) {
    if (!isVisible(lm, threshold)) continue;
    ctx.beginPath();
    ctx.arc(lm.x * width, lm.y * height, LANDMARK_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * canvas の drawing buffer サイズを CSS サイズ × devicePixelRatio に揃え、
 * 描画コンテキストをそれに合わせてスケールする。Retina 対応。
 * canvas.width の再代入で 2D state がリセットされるため、resize 後は
 * 必ず本関数の戻り値を使うこと (古い ctx を再利用しないこと)。
 *
 * @returns 新しい 2D context。canvas が 2D を取得できない場合は null。
 */
export function resizeOverlayCanvas(
  canvas: HTMLCanvasElement,
): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  return ctx;
}
